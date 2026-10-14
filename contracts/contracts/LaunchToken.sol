// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token created by ForexLaunchpad. Fixed supply, minted once to the launchpad.
contract LaunchToken is ERC20 {
    address public immutable launchpad;
    address public immutable creator;
    address public immutable quoteToken;
    string public metadataURI;

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
}
