// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LaunchToken} from "./LaunchToken.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title MapinLaunchpad
/// @notice Two-layer launchpad on the world map.
///   1. Currency layer: one community token per national currency (e.g. $DZD "Algerian Dinar"),
///      traded on a bonding curve against ETH (WETH). These are themed meme tokens with a free
///      market price. They are NOT stablecoins and are not pegged to any fiat currency.
///   2. Country layer: one token per country, traded on a bonding curve against its national
///      currency token (Algeria -> $DZD, Malaysia -> $MYR, United Kingdom -> $GBP ...).
///   Anyone can launch a currency or a country (first come, first served) and earns its creator fee.
///   `buyWithETH` / `sellForETH` route through both curves so users only need ETH.
/// @dev Constant-product curve on virtual reserves (virtualQuote * virtualToken = k). Fees are
///      charged outside the curve in the quote token. Graduated curves stop trading; the owner
///      migrates the raised quote + LP reserve to a DEX pool.
contract MapinLaunchpad is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 800_000_000 ether; // 80% sold on the curve
    uint256 public constant LP_RESERVE = TOTAL_SUPPLY - CURVE_SUPPLY;
    uint256 public constant INITIAL_VIRTUAL_TOKEN = 1_073_000_000 ether;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 200; // platform fee cap 2%
    uint256 public constant MAX_CREATOR_FEE_BPS = 100; // creator fee cap 1%

    uint8 public constant KIND_CURRENCY = 1;
    uint8 public constant KIND_COUNTRY = 2;

    IWETH public immutable weth;

    // ---------------------------------------------------------------- types
    struct Curve {
        address quote;
        address creator;
        bytes32 key; // currency code ("DZD") or place id ("DZ")
        uint8 kind;
        uint16 creatorFeeBps;
        uint64 createdAt;
        bool graduated;
        bool migrated;
        uint256 virtualQuote;
        uint256 virtualToken;
        uint256 realQuote;
        uint256 tokensSold;
    }

    struct LaunchParams {
        bytes32 key;
        string name;
        string symbol;
        string metadataURI;
        uint16 creatorFeeBps;
        uint256 minMidOut; // country launches with ETH: min currency tokens from the first hop
        uint256 minTokensOut;
    }

    // ---------------------------------------------------------------- storage
    mapping(address => Curve) public curves;
    mapping(bytes32 => bool) public knownCurrency; // "DZD" => true
    mapping(bytes32 => address) public currencyToken; // "DZD" => $DZD token
    mapping(bytes32 => bytes32) public placeCurrency; // "DZ" => "DZD"
    mapping(bytes32 => address) public tokenByPlace; // "DZ" => $ALGERIA token
    address[] private _currencies;
    address[] private _countries;

    uint256 public currencyVirtualEth = 1.5 ether; // ~4.4 ETH raised to graduate
    // In currency-token units. 100M => a country graduates after ~293M currency tokens are raised
    // (about 0.57 ETH at a fresh currency price). 30M was far too small: 0.2 ETH graduated a country.
    uint256 public countryVirtualQuote = 100_000_000 ether;
    uint256 public feeBps = 100; // 1%
    address public feeRecipient;

    // ---------------------------------------------------------------- events
    event PlaceSet(bytes32 indexed placeId, bytes32 indexed currency);
    event CurrencyLaunched(address indexed token, address indexed creator, bytes32 indexed code, string name, string symbol, string metadataURI, uint16 creatorFeeBps);
    event CountryLaunched(address indexed token, address indexed creator, bytes32 indexed placeId, bytes32 currency, address quote, string name, string symbol, string metadataURI, uint16 creatorFeeBps);
    event Trade(address indexed token, address indexed trader, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 platformFee, uint256 creatorFee, uint256 virtualQuote, uint256 virtualToken);
    event Graduated(address indexed token, uint256 realQuote);
    event Migrated(address indexed token, address indexed to, uint256 quoteAmount, uint256 tokenAmount);
    event ParamsUpdated(uint256 currencyVirtualEth, uint256 countryVirtualQuote, uint256 feeBps, address feeRecipient);

    // ---------------------------------------------------------------- errors
    error UnknownPlace();
    error UnknownCurrency();
    error CurrencyNotLaunched();
    error AlreadyLaunched();
    error UnknownToken();
    error AlreadyGraduated();
    error NotGraduated();
    error AlreadyMigrated();
    error ZeroAmount();
    error Slippage();
    error Expired();
    error BadParam();
    error EthTransferFailed();

    constructor(address owner_, address feeRecipient_, address weth_) Ownable(owner_) {
        if (feeRecipient_ == address(0) || weth_ == address(0)) revert BadParam();
        feeRecipient = feeRecipient_;
        weth = IWETH(weth_);
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert BadParam();
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // ================================================================ admin
    /// @notice Register map places with their national currency ("DZ" => "DZD").
    function setPlaces(bytes32[] calldata placeIds, bytes32[] calldata currencies) external onlyOwner {
        if (placeIds.length != currencies.length) revert BadParam();
        for (uint256 i; i < placeIds.length; ++i) {
            if (placeIds[i] == bytes32(0) || currencies[i] == bytes32(0)) revert BadParam();
            placeCurrency[placeIds[i]] = currencies[i];
            knownCurrency[currencies[i]] = true;
            emit PlaceSet(placeIds[i], currencies[i]);
        }
    }

    function setParams(uint256 currencyVirtualEth_, uint256 countryVirtualQuote_, uint256 feeBps_, address feeRecipient_)
        external
        onlyOwner
    {
        if (currencyVirtualEth_ == 0 || countryVirtualQuote_ == 0 || feeBps_ > MAX_FEE_BPS || feeRecipient_ == address(0)) {
            revert BadParam();
        }
        currencyVirtualEth = currencyVirtualEth_;
        countryVirtualQuote = countryVirtualQuote_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit ParamsUpdated(currencyVirtualEth_, countryVirtualQuote_, feeBps_, feeRecipient_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice After graduation, move the raised quote and the LP reserve to `to` to seed a DEX pool.
    function migrate(address token, address to) external onlyOwner nonReentrant {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (!c.graduated) revert NotGraduated();
        if (c.migrated) revert AlreadyMigrated();
        if (to == address(0)) revert BadParam();
        c.migrated = true;
        uint256 q = c.realQuote;
        c.realQuote = 0;
        IERC20(c.quote).safeTransfer(to, q);
        IERC20(token).safeTransfer(to, LP_RESERVE);
        emit Migrated(token, to, q, LP_RESERVE);
    }

    // ================================================================ launches
    /// @notice Launch the token for a national currency, paired with ETH. Send ETH to buy some at launch.
    function launchCurrency(LaunchParams calldata p) external payable nonReentrant whenNotPaused returns (address token) {
        if (!knownCurrency[p.key]) revert UnknownCurrency();
        if (currencyToken[p.key] != address(0)) revert AlreadyLaunched();
        token = _newCurve(p, KIND_CURRENCY, address(weth), currencyVirtualEth);
        currencyToken[p.key] = token;
        _currencies.push(token);
        emit CurrencyLaunched(token, msg.sender, p.key, p.name, p.symbol, p.metadataURI, p.creatorFeeBps);
        if (msg.value > 0) _buyWithEth(token, msg.value, 0, p.minTokensOut, msg.sender);
    }

    /// @notice Launch the token for a country, paired with its national currency token.
    ///         Send ETH to buy some at launch (routed ETH -> currency -> country).
    function launchCountry(LaunchParams calldata p) external payable nonReentrant whenNotPaused returns (address token) {
        bytes32 cur = placeCurrency[p.key];
        if (cur == bytes32(0)) revert UnknownPlace();
        if (tokenByPlace[p.key] != address(0)) revert AlreadyLaunched();
        address quote = currencyToken[cur];
        if (quote == address(0)) revert CurrencyNotLaunched();
        token = _newCurve(p, KIND_COUNTRY, quote, countryVirtualQuote);
        tokenByPlace[p.key] = token;
        _countries.push(token);
        emit CountryLaunched(token, msg.sender, p.key, cur, quote, p.name, p.symbol, p.metadataURI, p.creatorFeeBps);
        if (msg.value > 0) _buyWithEth(token, msg.value, p.minMidOut, p.minTokensOut, msg.sender);
    }

    function _newCurve(LaunchParams calldata p, uint8 kind, address quote, uint256 virtualQuote) internal returns (address token) {
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert BadParam();
        if (p.creatorFeeBps > MAX_CREATOR_FEE_BPS) revert BadParam();
        token = address(new LaunchToken(p.name, p.symbol, TOTAL_SUPPLY, msg.sender, quote, p.metadataURI));
        Curve storage c = curves[token];
        c.quote = quote;
        c.creator = msg.sender;
        c.key = p.key;
        c.kind = kind;
        c.creatorFeeBps = p.creatorFeeBps;
        c.createdAt = uint64(block.timestamp);
        c.virtualQuote = virtualQuote;
        c.virtualToken = INITIAL_VIRTUAL_TOKEN;
    }

    // ================================================================ trading: direct
    /// @notice Buy with the curve's own quote token (WETH for currencies, the currency token for countries).
    function buy(address token, uint256 quoteIn, uint256 minTokensOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        uint256 refund;
        (tokensOut, refund) = _buy(token, quoteIn, minTokensOut, msg.sender, msg.sender);
        if (refund > 0) IERC20(curves[token].quote).safeTransfer(msg.sender, refund);
    }

    /// @notice Sell for the curve's own quote token.
    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        beforeDeadline(deadline)
        returns (uint256 quoteOut)
    {
        return _sell(token, tokensIn, minQuoteOut, msg.sender, msg.sender);
    }

    // ================================================================ trading: ETH routes
    /// @notice Buy any mapin token with ETH. Countries route ETH -> currency -> country.
    /// @param minMidOut minimum currency tokens from the first hop (countries only)
    function buyWithETH(address token, uint256 minMidOut, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        whenNotPaused
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert ZeroAmount();
        return _buyWithEth(token, msg.value, minMidOut, minTokensOut, msg.sender);
    }

    /// @notice Sell any mapin token for ETH. Countries route country -> currency -> ETH.
    function sellForETH(address token, uint256 tokensIn, uint256 minMidOut, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        beforeDeadline(deadline)
        returns (uint256 ethOut)
    {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            ethOut = _sell(token, tokensIn, minEthOut, msg.sender, address(this));
        } else if (c.kind == KIND_COUNTRY) {
            uint256 mid = _sell(token, tokensIn, minMidOut, msg.sender, address(this));
            ethOut = _sell(c.quote, mid, minEthOut, address(this), address(this));
        } else {
            revert UnknownToken();
        }
        _sendEth(msg.sender, ethOut);
    }

    function _buyWithEth(address token, uint256 ethIn, uint256 minMidOut, uint256 minTokensOut, address to)
        internal
        returns (uint256 tokensOut)
    {
        Curve storage c = curves[token];
        weth.deposit{value: ethIn}();
        uint256 refund;
        if (c.kind == KIND_CURRENCY) {
            (tokensOut, refund) = _buy(token, ethIn, minTokensOut, address(this), to);
            if (refund > 0) _unwrapTo(to, refund);
        } else if (c.kind == KIND_COUNTRY) {
            (uint256 mid, uint256 ethRefund) = _buy(c.quote, ethIn, minMidOut, address(this), address(this));
            if (ethRefund > 0) _unwrapTo(to, ethRefund);
            (tokensOut, refund) = _buy(token, mid, minTokensOut, address(this), to);
            if (refund > 0) IERC20(c.quote).safeTransfer(to, refund);
        } else {
            revert UnknownToken();
        }
    }

    // ================================================================ core curve logic
    /// @dev payer == address(this) means the quote is already held by the launchpad.
    ///      to == address(this) keeps the bought tokens inside the launchpad (first hop of a route).
    ///      Returns the unused part of quoteIn (when the buy fills the curve); the caller returns it.
    function _buy(address token, uint256 quoteIn, uint256 minTokensOut, address payer, address to)
        internal
        returns (uint256 tokensOut, uint256 refund)
    {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
        if (quoteIn == 0) revert ZeroAmount();

        IERC20 q = IERC20(c.quote);
        uint256 received = quoteIn;
        if (payer != address(this)) {
            uint256 before = q.balanceOf(address(this));
            q.safeTransferFrom(payer, address(this), quoteIn);
            received = q.balanceOf(address(this)) - before;
        }

        uint256 net;
        uint256 fee;
        (net, fee, tokensOut, refund) = _computeBuy(c, received);
        if (tokensOut < minTokensOut || tokensOut == 0) revert Slippage();
        (uint256 pFee, uint256 cFee) = _splitFee(fee, c);

        c.virtualQuote += net;
        c.virtualToken -= tokensOut;
        c.realQuote += net;
        c.tokensSold += tokensOut;

        if (pFee > 0) q.safeTransfer(feeRecipient, pFee);
        if (cFee > 0) q.safeTransfer(c.creator, cFee);
        if (to != address(this)) IERC20(token).safeTransfer(to, tokensOut);

        emit Trade(token, payer == address(this) ? to : payer, true, net + fee, tokensOut, pFee, cFee, c.virtualQuote, c.virtualToken);

        if (c.tokensSold == CURVE_SUPPLY) {
            c.graduated = true;
            emit Graduated(token, c.realQuote);
        }
    }

    function _sell(address token, uint256 tokensIn, uint256 minQuoteOut, address payer, address to)
        internal
        returns (uint256 quoteOut)
    {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
        if (tokensIn == 0) revert ZeroAmount();

        if (payer != address(this)) IERC20(token).safeTransferFrom(payer, address(this), tokensIn);

        uint256 gross = Math.mulDiv(c.virtualQuote, tokensIn, c.virtualToken + tokensIn);
        if (gross > c.realQuote) gross = c.realQuote;
        (uint256 pFee, uint256 cFee) = _splitFee(Math.mulDiv(gross, _totalFeeBps(c), BPS), c);
        quoteOut = gross - pFee - cFee;
        if (quoteOut < minQuoteOut || quoteOut == 0) revert Slippage();

        c.virtualQuote -= gross;
        c.virtualToken += tokensIn;
        c.realQuote -= gross;
        c.tokensSold -= tokensIn;

        IERC20 q = IERC20(c.quote);
        if (pFee > 0) q.safeTransfer(feeRecipient, pFee);
        if (cFee > 0) q.safeTransfer(c.creator, cFee);
        if (to != address(this)) q.safeTransfer(to, quoteOut);

        emit Trade(token, payer == address(this) ? msg.sender : payer, false, quoteOut, tokensIn, pFee, cFee, c.virtualQuote, c.virtualToken);
    }

    function _unwrapTo(address to, uint256 amount) internal {
        weth.withdraw(amount);
        _sendEth(to, amount);
    }

    function _sendEth(address to, uint256 amountWeth) internal {
        if (amountWeth == 0) return;
        if (IERC20(address(weth)).balanceOf(address(this)) >= amountWeth && address(this).balance < amountWeth) {
            weth.withdraw(amountWeth);
        }
        (bool ok,) = to.call{value: amountWeth}("");
        if (!ok) revert EthTransferFailed();
    }

    function _totalFeeBps(Curve storage c) internal view returns (uint256) {
        return feeBps + c.creatorFeeBps;
    }

    function _splitFee(uint256 fee, Curve storage c) internal view returns (uint256 pFee, uint256 cFee) {
        uint256 total = _totalFeeBps(c);
        if (fee == 0 || total == 0) return (0, 0);
        cFee = Math.mulDiv(fee, c.creatorFeeBps, total);
        pFee = fee - cFee;
    }

    function _computeBuy(Curve storage c, uint256 quoteIn)
        internal
        view
        returns (uint256 net, uint256 fee, uint256 out, uint256 refund)
    {
        return _computeBuyRaw(c.virtualQuote, c.virtualToken, c.tokensSold, _totalFeeBps(c), quoteIn);
    }

    function _computeBuyRaw(uint256 vQ, uint256 vT, uint256 sold, uint256 f, uint256 quoteIn)
        internal
        pure
        returns (uint256 net, uint256 fee, uint256 out, uint256 refund)
    {
        fee = Math.mulDiv(quoteIn, f, BPS);
        net = quoteIn - fee;
        out = Math.mulDiv(vT, net, vQ + net);
        uint256 remaining = CURVE_SUPPLY - sold;
        if (out >= remaining) {
            out = remaining;
            net = Math.mulDiv(vQ, remaining, vT - remaining, Math.Rounding.Ceil);
            fee = Math.mulDiv(net, f, BPS - f, Math.Rounding.Ceil);
            uint256 total = net + fee;
            if (total > quoteIn) {
                fee = quoteIn - net;
                total = quoteIn;
            }
            refund = quoteIn - total;
        }
    }

    function _previewSell(Curve storage c, uint256 tokensIn) internal view returns (uint256 quoteOut, uint256 fee) {
        if (c.graduated || tokensIn == 0) return (0, 0);
        uint256 gross = Math.mulDiv(c.virtualQuote, tokensIn, c.virtualToken + tokensIn);
        if (gross > c.realQuote) gross = c.realQuote;
        fee = Math.mulDiv(gross, _totalFeeBps(c), BPS);
        quoteOut = gross - fee;
    }

    // ================================================================ views
    function previewBuy(address token, uint256 quoteIn) public view returns (uint256 tokensOut, uint256 fee, uint256 refund) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.graduated) return (0, 0, quoteIn);
        (, fee, tokensOut, refund) = _computeBuy(c, quoteIn);
    }

    function previewSell(address token, uint256 tokensIn) public view returns (uint256 quoteOut, uint256 fee) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        return _previewSell(c, tokensIn);
    }

    /// @notice Expected output of buyWithETH: (currency tokens from hop 1, tokens out).
    function previewBuyWithETH(address token, uint256 ethIn) external view returns (uint256 midOut, uint256 tokensOut) {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            (tokensOut,,) = previewBuy(token, ethIn);
        } else if (c.kind == KIND_COUNTRY) {
            (midOut,,) = previewBuy(c.quote, ethIn);
            (tokensOut,,) = previewBuy(token, midOut);
        } else {
            revert UnknownToken();
        }
    }

    /// @notice Expected output of sellForETH: (currency tokens from hop 1, ETH out).
    function previewSellForETH(address token, uint256 tokensIn) external view returns (uint256 midOut, uint256 ethOut) {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            (ethOut,) = _previewSell(c, tokensIn);
        } else if (c.kind == KIND_COUNTRY) {
            (midOut,) = _previewSell(c, tokensIn);
            (ethOut,) = _previewSell(curves[c.quote], midOut);
        } else {
            revert UnknownToken();
        }
    }

    /// @notice Spot price: quote units per 1e18 token units.
    function spotPrice(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        return Math.mulDiv(c.virtualQuote, 1 ether, c.virtualToken);
    }

    /// @notice Spot price in ETH (wei per 1e18 tokens); countries go through their currency's price.
    function spotPriceEth(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.kind == KIND_COUNTRY) return Math.mulDiv(spotPrice(token), spotPrice(c.quote), 1 ether);
        return spotPrice(token);
    }

    function counts() external view returns (uint256 currencies, uint256 countries) {
        return (_currencies.length, _countries.length);
    }

    /// @notice Snapshot for the map. kind = KIND_CURRENCY or KIND_COUNTRY; oldest first.
    function getMapState(uint8 kind, uint256 offset, uint256 limit)
        external
        view
        returns (
            address[] memory tokens,
            bytes32[] memory keys,
            uint256[] memory pricesEth,
            uint256[] memory progressBps,
            uint256[] memory realQuote,
            bool[] memory graduated
        )
    {
        address[] storage list = kind == KIND_CURRENCY ? _currencies : _countries;
        uint256 n = list.length;
        uint256 len = offset >= n ? 0 : Math.min(n - offset, limit);
        tokens = new address[](len);
        keys = new bytes32[](len);
        pricesEth = new uint256[](len);
        progressBps = new uint256[](len);
        realQuote = new uint256[](len);
        graduated = new bool[](len);
        for (uint256 i; i < len; ++i) {
            address t = list[offset + i];
            Curve storage c = curves[t];
            tokens[i] = t;
            keys[i] = c.key;
            pricesEth[i] = spotPriceEth(t);
            progressBps[i] = Math.mulDiv(c.tokensSold, BPS, CURVE_SUPPLY);
            realQuote[i] = c.realQuote;
            graduated[i] = c.graduated;
        }
    }
}
