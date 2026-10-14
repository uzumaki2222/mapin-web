// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token created by MapinLaunchpad. Fixed supply, minted once to the launchpad.
///         Its Uniswap V2 pair (token / quote) is created at launch. Until the token graduates,
///         nobody but the launchpad can send tokens to that pair, so the pool cannot be seeded
///         at a fake price before the real liquidity arrives.
contract LaunchToken is ERC20 {
    address public immutable launchpad;
    address public immutable creator;
    /// @notice What this token is paired with: the country's currency coin, or WETH for a currency coin.
    address public immutable quoteToken;
    string public metadataURI;
    /// @notice Uniswap V2 pair of this token and `quoteToken`.
    address public pair;
    /// @notice True once the bonding curve graduated and liquidity moved to `pair`.
    bool public dexOpen;

    error OnlyLaunchpad();
    error DexNotOpen();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        address creator_,
        address quoteToken_,
        string memory metadataURI_
    ) ERC20(name_, symbol_) {
        launchpad = msg.sender;
        creator = creator_;
        quoteToken = quoteToken_;
        metadataURI = metadataURI_;
        _mint(msg.sender, supply);
    }

    function setPair(address pair_) external {
        if (msg.sender != launchpad || pair != address(0)) revert OnlyLaunchpad();
        pair = pair_;
    }

    function openDex() external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        dexOpen = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!dexOpen && to == pair && to != address(0) && from != launchpad) revert DexNotOpen();
        super._update(from, to, value);
    }
}
