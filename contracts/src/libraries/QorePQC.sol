// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IQorePQC} from "../interfaces/IQorePQC.sol";

/// @title QorePQC
/// @notice Fail-closed wrappers around QoreChain's `pqcKeyStatus` and `pqcVerify` precompiles.
/// @dev Design rules:
///      1. The public key is ALWAYS read from the chain's key registry (`pqcKeyStatus`), never taken
///         from the caller. A signature therefore only counts for the account that registered the key.
///      2. Every unexpected answer reverts: no code at the precompile, a revert, a malformed or
///         non-boolean return, an unknown algorithm, a key or signature of the wrong length.
///      3. Sizes and the algorithm id come from FIPS 204 and `qorechain.pqc.v1`
///         (QoreSign 0.2.0: ALGORITHM_ML_DSA_87 = 1, 2592-byte keys, 4627-byte signatures).
library QorePQC {
    /// @notice `pqcVerify` precompile.
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    /// @notice `pqcKeyStatus` precompile.
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    /// @notice Algorithm id of ML-DSA-87 (named Dilithium5 on chain).
    uint8 internal constant ALGORITHM_ML_DSA_87 = 1;
    uint256 internal constant ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
    uint256 internal constant ML_DSA_87_SIGNATURE_LENGTH = 4627;

    /// @notice The precompile has no code or returned nothing (inactive on this network).
    error PqcPrecompileUnavailable(address precompile);
    /// @notice The account has no post-quantum key registered on chain.
    error PqcKeyNotRegistered(address account);
    /// @notice The account's registered key is not ML-DSA-87.
    error PqcUnsupportedAlgorithm(address account, uint8 algorithmId);
    /// @notice The registered key does not have the ML-DSA-87 length.
    error PqcMalformedKey(address account, uint256 length);
    /// @notice The signature does not have the ML-DSA-87 length.
    error PqcMalformedSignature(uint256 length);
    /// @notice The signature does not verify under the account's registered key.
    error PqcInvalidSignature(address account);

    /// @notice Returns `account`'s registered ML-DSA-87 public key, or reverts.
    function keyOf(address account) internal view returns (bytes memory pubkey) {
        (bool ok, bytes memory ret) = PQC_KEY_STATUS.staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (account)));
        if (!ok || ret.length == 0) revert PqcPrecompileUnavailable(PQC_KEY_STATUS);

        bool registered;
        uint8 algorithmId;
        (registered, algorithmId, pubkey) = abi.decode(ret, (bool, uint8, bytes));
        if (!registered) revert PqcKeyNotRegistered(account);
        if (algorithmId != ALGORITHM_ML_DSA_87) revert PqcUnsupportedAlgorithm(account, algorithmId);
        if (pubkey.length != ML_DSA_87_PUBLIC_KEY_LENGTH) revert PqcMalformedKey(account, pubkey.length);
    }

    /// @notice Reverts unless `signature` is a valid ML-DSA-87 signature of `signedBytes`
    ///         under the key `signer` registered on chain.
    /// @param signedBytes The exact bytes the wallet signed (domain prefix included).
    function verify(address signer, bytes memory signedBytes, bytes calldata signature) internal view {
        if (signature.length != ML_DSA_87_SIGNATURE_LENGTH) revert PqcMalformedSignature(signature.length);
        if (!accepts(keyOf(signer), signedBytes, signature)) revert PqcInvalidSignature(signer);
    }

    /// @notice Whether `pqcVerify` accepts `signature` of `signedBytes` under `pubkey`.
    /// @dev Only `true` when the precompile answers with exactly one ABI word holding 1; a revert,
    ///      a short or non-boolean answer all count as invalid. Reverts if the precompile is inactive.
    function accepts(bytes memory pubkey, bytes memory signedBytes, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeCall(IQorePQC.pqcVerify, (pubkey, signature, signedBytes)));
        // A call to an address without code succeeds with empty return data.
        if (ok && ret.length == 0) revert PqcPrecompileUnavailable(PQC_VERIFY);
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
