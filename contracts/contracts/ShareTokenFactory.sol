// SPDX-License-Identifier: LicenseRef-Ledova-Noncommercial-1.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ShareToken.sol";
import "./WhitelistRegistry.sol";

contract ShareTokenFactory is Ownable {
    address[] public deployedTokens;
    mapping(string => address) public tokenByIdentifier;
    mapping(address => bool) public isDeployedToken;
    mapping(string => address) public registryOf;

    event ShareTokenCreated(address indexed tokenAddress, string identifier, string symbol, uint256 authorizedShares);
    event WhitelistRegistryCreated(string acn, address indexed registry);

    error CompanyAlreadyExists(string identifier);
    error InvalidParameters();
    error RegistryOwnerMismatch(address registry, address tokenOwner);

    constructor(address _owner) Ownable(_owner) {}

    function createShareToken(
        string calldata name,
        string calldata symbol,
        string calldata identifier,
        string calldata acn,
        uint256 authorizedShares,
        address tokenOwner
    ) external onlyOwner returns (address tokenAddress) {
        if (bytes(identifier).length == 0 || bytes(acn).length == 0) revert InvalidParameters();
        if (tokenByIdentifier[identifier] != address(0)) revert CompanyAlreadyExists(identifier);
        if (tokenOwner == address(0)) revert InvalidParameters();
        if (authorizedShares == 0) revert InvalidParameters();

        address registry = registryOf[acn];
        if (registry == address(0)) {
            registry = address(new WhitelistRegistry(tokenOwner));
            registryOf[acn] = registry;
            emit WhitelistRegistryCreated(acn, registry);
        } else if (WhitelistRegistry(registry).owner() != tokenOwner) {
            revert RegistryOwnerMismatch(registry, tokenOwner);
        }

        ShareToken token = new ShareToken(name, symbol, registry, authorizedShares, tokenOwner);

        tokenAddress = address(token);
        deployedTokens.push(tokenAddress);
        tokenByIdentifier[identifier] = tokenAddress;
        isDeployedToken[tokenAddress] = true;

        emit ShareTokenCreated(tokenAddress, identifier, symbol, authorizedShares);

        return tokenAddress;
    }

    function getDeployedTokenCount() external view returns (uint256) {
        return deployedTokens.length;
    }

    function getTokenByIdentifier(string calldata identifier) external view returns (address) {
        return tokenByIdentifier[identifier];
    }
}
