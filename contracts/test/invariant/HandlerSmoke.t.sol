// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConclaveTestBase} from "../utils/ConclaveTestBase.sol";
import {ConclaveHandler} from "./ConclaveHandler.sol";

contract HandlerSmokeTest is ConclaveTestBase {
    function test_HandlerHappyPath() public {
        ConclaveHandler h = new ConclaveHandler(conclave, _founders(), guardian, attacker);
        h.proposePayout(0, 0, 5 ether);
        h.vote(0, 0, 1);
        h.vote(0, 1, 1);
        h.warp(1); // 1 % 8 != 0 -> short step, bounded to <= 2h
        vm.warp(block.timestamp + 2 hours);
        h.execute(0);
        assertEq(h.ghostExecuted(), 1);
    }
}
