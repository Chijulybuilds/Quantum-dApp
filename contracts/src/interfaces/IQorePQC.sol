// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IQorePQC
/// @notice Interface of QoreChain's post-quantum EVM precompiles.
/// @dev Active on the diana testnet (`qorechain-diana`, EVM chain id 9800); not yet on mainnet.
///      - `pqcVerify`    at 0x0000000000000000000000000000000000000a01
///      - `pqcKeyStatus` at 0x0000000000000000000000000000000000000a02
///      ABI taken from `IQORE_PQC_ABI` in the QoreChain EVM kit (npm qorechain/evm 0.14.0).
interface IQorePQC {
    /// @notice Verifies an ML-DSA signature of `message` under `pubkey`.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @notice Returns the post-quantum key an account registered on chain (with proof of possession).
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}
