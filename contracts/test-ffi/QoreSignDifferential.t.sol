// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "../test/utils/ConclaveTestBase.sol";

/// @notice Differential tests against the official QoreSign library (the code QoreX uses to sign).
/// @dev Run with `npm run test:ffi` (FOUNDRY_PROFILE=ffi). They prove that the bytes the contract
///      hands to `pqcVerify` are exactly the bytes a QoreX ML-DSA-87 signature covers.
contract QoreSignDifferentialTest is ConclaveTestBase {
    function _node(string memory command, string memory a, string memory b, string memory c)
        internal
        returns (bytes memory)
    {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = "test-ffi/qoresign.mjs";
        cmd[2] = command;
        cmd[3] = a;
        cmd[4] = b;
        cmd[5] = c;
        return vm.ffi(cmd);
    }

    function _assertMatchesQoreSign(string memory message) internal {
        bytes memory fromContract = conclave.signingBytes(message);
        bytes memory fromQoreSign = _node("signing-bytes", NATIVE_CHAIN_ID, vm.toString(bytes(message)), "");
        assertEq(fromContract, fromQoreSign, "contract signing bytes differ from QoreSign");

        (uint256 valid, uint256 sigLength) = abi.decode(
            _node("roundtrip", NATIVE_CHAIN_ID, vm.toString(bytes(message)), vm.toString(fromContract)),
            (uint256, uint256)
        );
        assertEq(valid, 1, "real ML-DSA-87 signature does not verify over the contract's bytes");
        assertEq(sigLength, QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
    }

    function test_ConstantsMatchQoreSign() public {
        (uint256 algorithmId, uint256 keyLength, uint256 sigLength) =
            abi.decode(_node("constants", "", "", ""), (uint256, uint256, uint256));
        assertEq(algorithmId, QorePQC.ALGORITHM_ML_DSA_87);
        assertEq(keyLength, QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        assertEq(sigLength, QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
    }

    function test_ProposeMessageMatchesQoreSign() public {
        _assertMatchesQoreSign(conclave.proposeMessage(alice, keccak256("proposal"), block.timestamp + 1 hours));
    }

    function test_VoteMessageMatchesQoreSign() public {
        uint256 id = _propose(alice, _payout(grantee, 1 ether));
        _assertMatchesQoreSign(conclave.voteMessage(id, bob, true));
        _assertMatchesQoreSign(conclave.voteMessage(id, carol, false));
    }

    function test_CancelMessageMatchesQoreSign() public {
        uint256 id = _propose(alice, _payout(grantee, 1 ether));
        _assertMatchesQoreSign(conclave.cancelMessage(id));
    }
}
