// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QorePQC} from "../src/libraries/QorePQC.sol";

/// @notice Exposes Conclave's precompile wrappers with calldata arguments.
contract QorePQCProbeHarness {
    function accepts(bytes calldata pubkey, bytes calldata signedBytes, bytes calldata signature)
        external
        view
        returns (bool)
    {
        return QorePQC.accepts(pubkey, signedBytes, signature);
    }

    function keyOf(address account) external view returns (bytes memory) {
        return QorePQC.keyOf(account);
    }
}

/// @notice Runs Conclave's Solidity PQC code against the LIVE QoreChain precompiles inside an
///         `eth_call` of this creation code: nothing is deployed and no funds are needed.
///         Used by `scripts/pqc-check.ts`.
/// @dev Returns abi.encode(validAccepted, tamperedAccepted, keyLength, keyHash).
contract LivePqcProbe {
    constructor(
        bytes memory pubkey,
        bytes memory signedBytes,
        bytes memory tamperedBytes,
        bytes memory signature,
        address registeredAccount
    ) {
        QorePQCProbeHarness h = new QorePQCProbeHarness();
        bool validAccepted = h.accepts(pubkey, signedBytes, signature);
        bool tamperedAccepted = h.accepts(pubkey, tamperedBytes, signature);
        uint256 keyLength;
        bytes32 keyHash;
        if (registeredAccount != address(0)) {
            bytes memory key = h.keyOf(registeredAccount);
            keyLength = key.length;
            keyHash = keccak256(key);
        }
        bytes memory out = abi.encode(validAccepted, tamperedAccepted, keyLength, keyHash);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
