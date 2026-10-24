// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Executor for the "1-tx bridge + mint" pattern via Across V3.
 *         The destination SpokePool calls handleV3AcrossMessage() when a deposit
 *         is filled; this contract receives the bridged funds and immediately
 *         executes the mint call.
 *
 *         NOTE: the Relay route (src/executor/relay.ts) does not require this
 *         contract. Deploy it only to enable the Across route for mints that
 *         rely on msg.sender (no `to` parameter).
 */
contract MintExecutor is Ownable {
    event Executed(address indexed target, uint256 value, bool ok);

    /// @dev SpokePool V3 per chain — ambil alamat resminya dari docs.across.to
    mapping(address => bool) public authorized;

    constructor() Ownable(msg.sender) {}

    function setAuthorized(address spokePool, bool ok) external onlyOwner {
        authorized[spokePool] = ok;
    }

    /**
     * @param tokenSent token yang nyampe (zero address = native)
     * @param amount    jumlah yang nyampe
     * @param relayer   filler yang ngeksekusi
     * @param message   abi.encode(address mintTarget, uint256 value, bytes mintCalldata)
     */
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address relayer,
        bytes calldata message
    ) external payable {
        require(authorized[msg.sender] || msg.sender == owner(), "UNAUTHORIZED");
        (address target, uint256 value, bytes memory callData) = abi.decode(
            message,
            (address, uint256, bytes)
        );
        (bool ok, ) = target.call{value: value}(callData);
        require(ok, "MINT_FAILED");
        emit Executed(target, value, ok);
    }

    receive() external payable {}

    function rescue(address to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "RESCUE_FAILED");
    }
}
