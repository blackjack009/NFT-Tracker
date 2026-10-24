// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MintExecutor} from "../src/MintExecutor.sol";

/// Deploy per chain:
///   chain=base  forge script script/DeployExecutor.s.sol --rpc-url $RPC_BASE --broadcast --private-key $PRIVATE_KEY
/// After deployment: call setAuthorized(<this chain's official V3 SpokePool>, true)
/// (official SpokePool addresses: docs.across.to — do NOT guess)
contract DeployExecutor is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        MintExecutor executor = new MintExecutor();
        executor.setAuthorized(msg.sender, true); // temporary: allow owner to execute (for testing)
        console.log("MintExecutor:", address(executor));
        vm.stopBroadcast();
    }
}
