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

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title MapinLaunchpad
/// @notice Launchpad on the world map, on Robinhood Chain.
///   1. Currency layer: one community coin per national currency (e.g. $MYR "Malaysian Ringgit"),
///      traded on a bonding curve against ETH (WETH). Themed meme coins with a free market price:
///      NOT stablecoins and not pegged to any fiat currency.
///   2. Country layer: any number of tokens per country, free name and ticker, each paired with that
///      country's currency coin (a token on Malaysia trades against $MYR).
///   Every token gets its Uniswap V2 pair (token / quote) at launch. When its curve sells out the
///   token graduates: the raised quote and the 200M LP reserve are added to that pair and the LP
///   tokens are burned. Graduation runs automatically in the buy that fills the curve; if that ever
///   fails, anyone can call migrateToDex(). The owner never touches the raised funds.
///   buyWithETH / sellForETH route through the curves, or through the Uniswap pairs once graduated.
contract MapinLaunchpad is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 800_000_000 ether; // 80% sold on the curve
    uint256 public constant LP_RESERVE = TOTAL_SUPPLY - CURVE_SUPPLY; // 20% seeds the Uniswap pair
    uint256 public constant INITIAL_VIRTUAL_TOKEN = 1_073_000_000 ether;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 200; // platform fee cap 2%
    uint256 public constant MAX_CREATOR_FEE_BPS = 100; // creator fee cap 1%
    address public constant LP_BURN = 0x000000000000000000000000000000000000dEaD;

    uint8 public constant KIND_CURRENCY = 1;
    uint8 public constant KIND_COUNTRY = 2;

    IWETH public immutable weth;
    IUniswapV2Factory public immutable dexFactory;

    // ---------------------------------------------------------------- types
    struct Curve {
        address quote;
        address creator;
        address pair; // Uniswap V2 pair token/quote
        bytes32 key; // currency code ("MYR") or place id ("MY")
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
        uint256 minMidOut; // country launches with ETH: min currency coins from the first hop
        uint256 minTokensOut;
    }

    struct TokenView {
        address token;
        bytes32 key;
        address quote;
        address creator;
        address pair;
        uint64 createdAt;
        uint16 creatorFeeBps;
        bool graduated;
        bool migrated;
        uint256 priceEth; // wei per 1e18 tokens
        uint256 progressBps;
        uint256 realQuote;
    }

    // ---------------------------------------------------------------- storage
    mapping(address => Curve) public curves;
    mapping(bytes32 => bool) public knownCurrency; // "MYR" => true
    mapping(bytes32 => address) public currencyToken; // "MYR" => $MYR coin
    mapping(bytes32 => bytes32) public placeCurrency; // "MY" => "MYR"
    mapping(bytes32 => address[]) private _placeTokens; // "MY" => every token launched on Malaysia
    address[] private _currencies;
    address[] private _countries;

    uint256 public currencyVirtualEth = 1.5 ether; // ~4.4 ETH raised to graduate
    // In currency-coin units. 100M => a country token graduates after ~293M currency coins are raised.
    uint256 public countryVirtualQuote = 100_000_000 ether;
    uint256 public feeBps = 100; // 1%
    address public feeRecipient;

    // ---------------------------------------------------------------- events
    event PlaceSet(bytes32 indexed placeId, bytes32 indexed currency);
    event CurrencyLaunched(address indexed token, address indexed creator, bytes32 indexed code, string name, string symbol, string metadataURI, uint16 creatorFeeBps);
    event CountryLaunched(address indexed token, address indexed creator, bytes32 indexed placeId, bytes32 currency, address quote, string name, string symbol, string metadataURI, uint16 creatorFeeBps);
    event PairCreated(address indexed token, address indexed quote, address pair);
    event Trade(address indexed token, address indexed trader, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 platformFee, uint256 creatorFee, uint256 virtualQuote, uint256 virtualToken);
    event Graduated(address indexed token, uint256 realQuote);
    event Migrated(address indexed token, address indexed pair, uint256 quoteAmount, uint256 tokenAmount, uint256 liquidity);
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
    error OnlySelf();

    constructor(address owner_, address feeRecipient_, address weth_, address dexFactory_) Ownable(owner_) {
        if (feeRecipient_ == address(0) || weth_ == address(0) || dexFactory_ == address(0)) revert BadParam();
        feeRecipient = feeRecipient_;
        weth = IWETH(weth_);
        dexFactory = IUniswapV2Factory(dexFactory_);
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert BadParam();
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // ================================================================ admin
    /// @notice Register map places with their national currency ("MY" => "MYR").
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

    // ================================================================ launches
    /// @notice Launch the coin of a national currency, paired with ETH. Send ETH to buy some at launch.
    function launchCurrency(LaunchParams calldata p) external payable nonReentrant whenNotPaused returns (address token) {
        if (!knownCurrency[p.key]) revert UnknownCurrency();
        if (currencyToken[p.key] != address(0)) revert AlreadyLaunched();
        token = _newCurve(p.key, p.name, p.symbol, p.metadataURI, p.creatorFeeBps, KIND_CURRENCY, address(weth), currencyVirtualEth);
        currencyToken[p.key] = token;
        _currencies.push(token);
        emit CurrencyLaunched(token, msg.sender, p.key, p.name, p.symbol, p.metadataURI, p.creatorFeeBps);
        if (msg.value > 0) _buyWithEth(token, msg.value, 0, p.minTokensOut, msg.sender);
    }

    /// @notice Launch any token (free name and ticker) on a country. It is paired with that country's
    ///         currency coin; any number of tokens can be launched per country. If the currency coin
    ///         does not exist yet it is launched first in the same transaction, using `curName` /
    ///         `curSymbol` (the caller becomes its creator too). Send ETH to buy some at launch.
    function launchCountry(LaunchParams calldata p, string calldata curName, string calldata curSymbol)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (address token)
    {
        bytes32 cur = placeCurrency[p.key];
        if (cur == bytes32(0)) revert UnknownPlace();
        address quote = currencyToken[cur];
        if (quote == address(0)) {
            if (bytes(curName).length == 0 || bytes(curSymbol).length == 0) revert CurrencyNotLaunched();
            quote = _newCurve(cur, curName, curSymbol, "", p.creatorFeeBps, KIND_CURRENCY, address(weth), currencyVirtualEth);
            currencyToken[cur] = quote;
            _currencies.push(quote);
            emit CurrencyLaunched(quote, msg.sender, cur, curName, curSymbol, "", p.creatorFeeBps);
        }
        token = _newCurve(p.key, p.name, p.symbol, p.metadataURI, p.creatorFeeBps, KIND_COUNTRY, quote, countryVirtualQuote);
        _placeTokens[p.key].push(token);
        _countries.push(token);
        emit CountryLaunched(token, msg.sender, p.key, cur, quote, p.name, p.symbol, p.metadataURI, p.creatorFeeBps);
        if (msg.value > 0) _buyWithEth(token, msg.value, p.minMidOut, p.minTokensOut, msg.sender);
    }

    function _newCurve(
        bytes32 key,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint16 creatorFeeBps,
        uint8 kind,
        address quote,
        uint256 virtualQuote
    ) internal returns (address token) {
        if (bytes(name).length == 0 || bytes(symbol).length == 0) revert BadParam();
        if (creatorFeeBps > MAX_CREATOR_FEE_BPS) revert BadParam();
        token = address(new LaunchToken(name, symbol, TOTAL_SUPPLY, msg.sender, quote, metadataURI));
        address pair = dexFactory.createPair(token, quote);
        LaunchToken(token).setPair(pair);
        Curve storage c = curves[token];
        c.quote = quote;
        c.creator = msg.sender;
        c.pair = pair;
        c.key = key;
        c.kind = kind;
        c.creatorFeeBps = creatorFeeBps;
        c.createdAt = uint64(block.timestamp);
        c.virtualQuote = virtualQuote;
        c.virtualToken = INITIAL_VIRTUAL_TOKEN;
        emit PairCreated(token, quote, pair);
    }

    // ================================================================ graduation
    /// @notice Add a graduated token's raised quote + LP reserve to its Uniswap V2 pair and burn the LP.
    ///         Runs automatically in the buy that fills the curve; anyone can call it if that failed.
    function migrateToDex(address token) external nonReentrant {
        _migrate(token);
    }

    /// @dev Self-call target so the automatic migration can be wrapped in try/catch.
    function autoMigrate(address token) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _migrate(token);
    }

    function _migrate(address token) internal {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (!c.graduated) revert NotGraduated();
        if (c.migrated) revert AlreadyMigrated();
        c.migrated = true;
        uint256 q = c.realQuote;
        c.realQuote = 0;
        LaunchToken(token).openDex();
        IERC20(c.quote).safeTransfer(c.pair, q);
        IERC20(token).safeTransfer(c.pair, LP_RESERVE);
        uint256 liquidity = IUniswapV2Pair(c.pair).mint(LP_BURN);
        emit Migrated(token, c.pair, q, LP_RESERVE, liquidity);
    }

    // ================================================================ trading: direct (curve only)
    /// @notice Buy on the curve with the token's own quote (WETH for currency coins, the currency coin for countries).
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

    /// @notice Sell on the curve for the token's own quote.
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
    /// @notice Buy any mapin token with ETH. Country tokens route ETH -> currency coin -> token. Each hop
    ///         uses the bonding curve, or the Uniswap pair once that token has graduated.
    /// @param minMidOut minimum currency coins from the first hop (country tokens only)
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

    /// @notice Sell any mapin token for ETH along the same route backwards.
    function sellForETH(address token, uint256 tokensIn, uint256 minMidOut, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        beforeDeadline(deadline)
        returns (uint256 ethOut)
    {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            ethOut = _hopOut(token, tokensIn, minEthOut, msg.sender);
        } else if (c.kind == KIND_COUNTRY) {
            uint256 mid = _hopOut(token, tokensIn, minMidOut, msg.sender);
            ethOut = _hopOut(c.quote, mid, minEthOut, address(this));
        } else {
            revert UnknownToken();
        }
        _unwrapTo(msg.sender, ethOut);
    }

    function _buyWithEth(address token, uint256 ethIn, uint256 minMidOut, uint256 minTokensOut, address to)
        internal
        returns (uint256 tokensOut)
    {
        Curve storage c = curves[token];
        weth.deposit{value: ethIn}();
        if (c.kind == KIND_CURRENCY) {
            uint256 refund;
            (tokensOut, refund) = _hopIn(token, ethIn, minTokensOut, to);
            if (refund > 0) _unwrapTo(to, refund);
        } else if (c.kind == KIND_COUNTRY) {
            (uint256 mid, uint256 ethRefund) = _hopIn(c.quote, ethIn, minMidOut, address(this));
            if (ethRefund > 0) _unwrapTo(to, ethRefund);
            uint256 refund;
            (tokensOut, refund) = _hopIn(token, mid, minTokensOut, to);
            if (refund > 0) IERC20(c.quote).safeTransfer(to, refund);
        } else {
            revert UnknownToken();
        }
    }

    /// @dev Buy `token` with `quoteIn` of its quote, already held by this contract. Curve or pair.
    function _hopIn(address token, uint256 quoteIn, uint256 minOut, address to) internal returns (uint256 out, uint256 refund) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.migrated) {
            if (quoteIn == 0) revert ZeroAmount();
            out = _swapOnPair(c.pair, c.quote, token, quoteIn, to);
            if (out < minOut || out == 0) revert Slippage();
        } else {
            (out, refund) = _buy(token, quoteIn, minOut, address(this), to);
        }
    }

    /// @dev Sell `tokensIn` of `token` (pulled from `payer` unless it is this contract) for its quote,
    ///      which stays in this contract. Curve or pair.
    function _hopOut(address token, uint256 tokensIn, uint256 minOut, address payer) internal returns (uint256 out) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.migrated) {
            if (tokensIn == 0) revert ZeroAmount();
            if (payer != address(this)) IERC20(token).safeTransferFrom(payer, address(this), tokensIn);
            out = _swapOnPair(c.pair, token, c.quote, tokensIn, address(this));
            if (out < minOut || out == 0) revert Slippage();
        } else {
            out = _sell(token, tokensIn, minOut, payer, address(this));
        }
    }

    /// @dev Exact-in swap on a Uniswap V2 pair. `amountIn` of `tokenIn` must be held by this contract.
    function _swapOnPair(address pair, address tokenIn, address tokenOut, uint256 amountIn, address to)
        internal
        returns (uint256 out)
    {
        IERC20(tokenIn).safeTransfer(pair, amountIn);
        (uint256 rIn, uint256 rOut, bool inIs0) = _reserves(pair, tokenIn);
        uint256 actualIn = IERC20(tokenIn).balanceOf(pair) - rIn;
        uint256 amount = _amountOut(actualIn, rIn, rOut);
        if (amount == 0) revert Slippage();
        uint256 before = IERC20(tokenOut).balanceOf(to);
        IUniswapV2Pair(pair).swap(inIs0 ? 0 : amount, inIs0 ? amount : 0, to, "");
        out = IERC20(tokenOut).balanceOf(to) - before;
    }

    function _reserves(address pair, address tokenIn) internal view returns (uint256 rIn, uint256 rOut, bool inIs0) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        inIs0 = IUniswapV2Pair(pair).token0() == tokenIn;
        (rIn, rOut) = inIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _amountOut(uint256 amountIn, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        if (amountIn == 0 || rIn == 0 || rOut == 0) return 0;
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * rOut) / (rIn * 1000 + inWithFee);
    }

    // ================================================================ core curve logic
    /// @dev payer == address(this): the quote is already held here. to == address(this): keep the
    ///      tokens here (first hop of a route). Returns the unused quote when the buy fills the curve.
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
        (net, fee, tokensOut, refund) = _computeBuyRaw(c.virtualQuote, c.virtualToken, c.tokensSold, _totalFeeBps(c), received);
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
            // Best effort: if this fails (e.g. too little gas), anyone can call migrateToDex later.
            try this.autoMigrate(token) {} catch {}
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
        if (amount == 0) return;
        weth.withdraw(amount);
        (bool ok,) = to.call{value: amount}("");
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

    // ================================================================ views
    /// @dev Expected output of one buy hop (curve or pair) without state changes.
    function _previewIn(address token, uint256 quoteIn) internal view returns (uint256 out) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.migrated) {
            (uint256 rIn, uint256 rOut,) = _reserves(c.pair, c.quote);
            return _amountOut(quoteIn, rIn, rOut);
        }
        if (c.graduated || quoteIn == 0) return 0;
        (,, out,) = _computeBuyRaw(c.virtualQuote, c.virtualToken, c.tokensSold, _totalFeeBps(c), quoteIn);
    }

    /// @dev Expected output of one sell hop (curve or pair).
    function _previewOut(address token, uint256 tokensIn) internal view returns (uint256 out) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.migrated) {
            (uint256 rIn, uint256 rOut,) = _reserves(c.pair, token);
            return _amountOut(tokensIn, rIn, rOut);
        }
        if (c.graduated || tokensIn == 0) return 0;
        uint256 gross = Math.mulDiv(c.virtualQuote, tokensIn, c.virtualToken + tokensIn);
        if (gross > c.realQuote) gross = c.realQuote;
        out = gross - Math.mulDiv(gross, _totalFeeBps(c), BPS);
    }

    function previewBuy(address token, uint256 quoteIn) public view returns (uint256 tokensOut, uint256 fee, uint256 refund) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.graduated) return (0, 0, quoteIn);
        (, fee, tokensOut, refund) = _computeBuyRaw(c.virtualQuote, c.virtualToken, c.tokensSold, _totalFeeBps(c), quoteIn);
    }

    function previewSell(address token, uint256 tokensIn) public view returns (uint256 quoteOut, uint256 fee) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.graduated || tokensIn == 0) return (0, 0);
        uint256 gross = Math.mulDiv(c.virtualQuote, tokensIn, c.virtualToken + tokensIn);
        if (gross > c.realQuote) gross = c.realQuote;
        fee = Math.mulDiv(gross, _totalFeeBps(c), BPS);
        quoteOut = gross - fee;
    }

    /// @notice Expected output of buyWithETH: (currency coins from hop 1, tokens out).
    function previewBuyWithETH(address token, uint256 ethIn) external view returns (uint256 midOut, uint256 tokensOut) {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            tokensOut = _previewIn(token, ethIn);
        } else if (c.kind == KIND_COUNTRY) {
            midOut = _previewIn(c.quote, ethIn);
            tokensOut = midOut == 0 ? 0 : _previewIn(token, midOut);
        } else {
            revert UnknownToken();
        }
    }

    /// @notice Expected output of sellForETH: (currency coins from hop 1, ETH out).
    function previewSellForETH(address token, uint256 tokensIn) external view returns (uint256 midOut, uint256 ethOut) {
        Curve storage c = curves[token];
        if (c.kind == KIND_CURRENCY) {
            ethOut = _previewOut(token, tokensIn);
        } else if (c.kind == KIND_COUNTRY) {
            midOut = _previewOut(token, tokensIn);
            ethOut = midOut == 0 ? 0 : _previewOut(c.quote, midOut);
        } else {
            revert UnknownToken();
        }
    }

    /// @notice Spot price: quote units per 1e18 tokens (curve, or Uniswap pair once migrated).
    function spotPrice(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.kind == 0) revert UnknownToken();
        if (c.migrated) {
            (uint256 rToken, uint256 rQuote,) = _reserves(c.pair, token);
            return rToken == 0 ? 0 : Math.mulDiv(rQuote, 1 ether, rToken);
        }
        return Math.mulDiv(c.virtualQuote, 1 ether, c.virtualToken);
    }

    /// @notice Spot price in ETH (wei per 1e18 tokens); country tokens go through their currency's price.
    function spotPriceEth(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.kind == KIND_COUNTRY) return Math.mulDiv(spotPrice(token), spotPrice(c.quote), 1 ether);
        return spotPrice(token);
    }

    function counts() external view returns (uint256 currencies, uint256 countries) {
        return (_currencies.length, _countries.length);
    }

    function _view(address t) internal view returns (TokenView memory v) {
        Curve storage c = curves[t];
        v.token = t;
        v.key = c.key;
        v.quote = c.quote;
        v.creator = c.creator;
        v.pair = c.pair;
        v.createdAt = c.createdAt;
        v.creatorFeeBps = c.creatorFeeBps;
        v.graduated = c.graduated;
        v.migrated = c.migrated;
        v.priceEth = spotPriceEth(t);
        v.progressBps = Math.mulDiv(c.tokensSold, BPS, CURVE_SUPPLY);
        v.realQuote = c.realQuote;
    }

    /// @notice Every launched token of one kind (KIND_CURRENCY or KIND_COUNTRY), oldest first.
    function getTokens(uint8 kind, uint256 offset, uint256 limit) external view returns (TokenView[] memory list) {
        address[] storage src = kind == KIND_CURRENCY ? _currencies : _countries;
        uint256 n = src.length;
        uint256 len = offset >= n ? 0 : Math.min(n - offset, limit);
        list = new TokenView[](len);
        for (uint256 i; i < len; ++i) list[i] = _view(src[offset + i]);
    }

    /// @notice Every token launched on one country, oldest first.
    function placeTokens(bytes32 placeId) external view returns (address[] memory) {
        return _placeTokens[placeId];
    }
}
