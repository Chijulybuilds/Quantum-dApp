// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {QorePQC} from "../src/libraries/QorePQC.sol";
import {MockQorePQC} from "./mocks/MockQorePQC.sol";

contract QorePQCHarness {
    function keyOf(address account) external view returns (bytes memory) {
        return QorePQC.keyOf(account);
    }

    function verify(address signer, bytes calldata signedBytes, bytes calldata signature) external view {
        QorePQC.verify(signer, signedBytes, signature);
    }
}

/// @notice The precompile wrappers fail closed on every unexpected answer.
contract QorePQCTest is Test {
    QorePQCHarness internal harness = new QorePQCHarness();
    MockQorePQC internal keyRegistry = MockQorePQC(QorePQC.PQC_KEY_STATUS);
    MockQorePQC internal verifier = MockQorePQC(QorePQC.PQC_VERIFY);
    address internal signer = makeAddr("signer");
    bytes internal pubkey;
    bytes internal message = "qorechain-msg-v1|qorechain-diana|hello";

    function setUp() public {
        bytes memory mockCode = address(new MockQorePQC()).code;
        vm.etch(QorePQC.PQC_VERIFY, mockCode);
        vm.etch(QorePQC.PQC_KEY_STATUS, mockCode);
        pubkey = new bytes(2592);
        pubkey[0] = 0x42;
        keyRegistry.setKey(signer, true, 1, pubkey);
    }

    function _validSig() internal view returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 t = verifier.tag(pubkey, message);
        assembly {
            mstore(add(sig, 32), t)
        }
    }

    function test_Constants() public pure {
        assertEq(QorePQC.PQC_VERIFY, address(0x0A01));
        assertEq(QorePQC.PQC_KEY_STATUS, address(0x0A02));
        assertEq(QorePQC.ALGORITHM_ML_DSA_87, 1);
        assertEq(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH, 2592);
        assertEq(QorePQC.ML_DSA_87_SIGNATURE_LENGTH, 4627);
    }

    function test_Verify_AcceptsValidSignature() public view {
        harness.verify(signer, message, _validSig());
        assertEq(harness.keyOf(signer), pubkey);
    }

    function test_Verify_RejectsOtherMessage() public {
        bytes memory sig = _validSig();
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, "qorechain-msg-v1|qorechain-diana|hellO", sig);
    }

    function test_Verify_UsesRegisteredKeyNotCallerKey() public {
        // A signature made with any other key is useless, even a perfectly valid one.
        bytes memory otherKey = new bytes(2592);
        otherKey[0] = 0x43;
        bytes memory sig = new bytes(4627);
        bytes32 t = verifier.tag(otherKey, message);
        assembly {
            mstore(add(sig, 32), t)
        }
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_SignatureLengthWrong() public {
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcMalformedSignature.selector, 4626));
        harness.verify(signer, message, new bytes(4626));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcMalformedSignature.selector, 0));
        harness.verify(signer, message, "");
    }

    function test_RevertWhen_VerifyPrecompileReverts() public {
        verifier.setMode(MockQorePQC.Mode.Revert);
        bytes memory sig = _validSig();
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_VerifyReturnsNonBoolean() public {
        verifier.setMode(MockQorePQC.Mode.NonBoolean);
        bytes memory sig = _validSig();
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_VerifyReturnsShortData() public {
        verifier.setMode(MockQorePQC.Mode.ShortReturn);
        bytes memory sig = _validSig();
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_VerifyReturnsFalse() public {
        verifier.setMode(MockQorePQC.Mode.AlwaysFalse);
        bytes memory sig = _validSig();
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, signer));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_VerifyPrecompileInactive() public {
        bytes memory sig = _validSig();
        vm.etch(QorePQC.PQC_VERIFY, "");
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcPrecompileUnavailable.selector, QorePQC.PQC_VERIFY));
        harness.verify(signer, message, sig);
    }

    function test_RevertWhen_KeyStatusPrecompileInactive() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, "");
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcPrecompileUnavailable.selector, QorePQC.PQC_KEY_STATUS));
        harness.keyOf(signer);
    }

    function test_RevertWhen_KeyStatusPrecompileReverts() public {
        keyRegistry.setMode(MockQorePQC.Mode.Revert);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcPrecompileUnavailable.selector, QorePQC.PQC_KEY_STATUS));
        harness.keyOf(signer);
    }

    function test_RevertWhen_KeyNotRegistered() public {
        address nobody = makeAddr("nobody");
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcKeyNotRegistered.selector, nobody));
        harness.keyOf(nobody);
    }

    function test_RevertWhen_KeyRegisteredFlagFalseEvenWithKeyBytes() public {
        keyRegistry.setKey(signer, false, 1, pubkey);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcKeyNotRegistered.selector, signer));
        harness.keyOf(signer);
    }

    function testFuzz_RevertWhen_AlgorithmIsNotMlDsa87(uint8 algorithmId) public {
        vm.assume(algorithmId != 1);
        keyRegistry.setKey(signer, true, algorithmId, pubkey);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcUnsupportedAlgorithm.selector, signer, algorithmId));
        harness.keyOf(signer);
    }

    function testFuzz_RevertWhen_KeyLengthIsWrong(uint16 length) public {
        vm.assume(length != 2592);
        length = uint16(bound(length, 0, 6000));
        vm.assume(length != 2592);
        keyRegistry.setKey(signer, true, 1, new bytes(length));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcMalformedKey.selector, signer, length));
        harness.keyOf(signer);
    }
}
