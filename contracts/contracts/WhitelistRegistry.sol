// SPDX-License-Identifier: LicenseRef-Ledova-Noncommercial-1.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract WhitelistRegistry is Ownable {
    mapping(address => uint64) public expiresAt;

    event ExpirySet(address indexed investor, uint64 expiresAt);

    error InvalidAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setExpiry(address investor, uint64 expiry) external onlyOwner {
        if (investor == address(0)) revert InvalidAddress();
        expiresAt[investor] = expiry;
        emit ExpirySet(investor, expiry);
    }

    function isWhitelisted(address investor) external view returns (bool) {
        return expiresAt[investor] > block.timestamp;
    }
}
