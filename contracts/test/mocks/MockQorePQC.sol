// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "../../src/interfaces/IQorePQC.sol";

/// @notice Stand-in for QoreChain's PQC precompiles in Foundry's local EVM, which does not have them.
/// @dev Etched (vm.etch) at both 0x...0a01 and 0x...0a02; each address keeps its own storage, so keys
///      are configured on the 0x...0a02 instance and the verify mode on the 0x...0a01 instance.
///      "Signatures" are a deterministic tag over (pubkey, message), so a signature is only valid for
///      the exact key and the exact bytes it was made for, just like ML-DSA-87.
contract MockQorePQC is IQorePQC {
    enum Mode {
        Normal,
        Revert,
        NonBoolean,
        AlwaysFalse,
        ShortReturn
    }

    struct KeyRecord {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
    }

    uint256 internal constant SIGNATURE_LENGTH = 4627;

    mapping(address => KeyRecord) internal _keys;
    /// @dev Seeded ML-DSA-87 keys, rebuilt in memory on every query so the mock does not add
    ///      ~170k gas of SLOADs per call (the real precompile keeps keys in native state).
    mapping(address => bytes32) internal _seeds;
    Mode public mode;

    uint256 internal constant KEY_LENGTH = 2592;

    /// @notice Registers an arbitrary key record (any algorithm, any length).
    function setKey(address account, bool registered, uint8 algorithmId, bytes calldata pubkey) external {
        _keys[account] = KeyRecord(registered, algorithmId, pubkey);
        delete _seeds[account];
    }

    /// @notice Registers a 2592-byte ML-DSA-87 key whose first word is `seed` (see `seededKey`).
    function setSeededKey(address account, bytes32 seed) external {
        delete _keys[account];
        _seeds[account] = seed;
    }

    function seededKey(bytes32 seed) public pure returns (bytes memory key) {
        key = new bytes(KEY_LENGTH);
        assembly {
            mstore(add(key, 32), seed)
        }
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory) {
        if (mode == Mode.Revert) revert("mock: key status reverted");
        bytes32 seed = _seeds[account];
        if (seed != bytes32(0)) return (true, 1, seededKey(seed));
        KeyRecord storage k = _keys[account];
        return (k.registered, k.algorithmId, k.pubkey);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool)
    {
        Mode m = mode;
        if (m == Mode.Revert) revert("mock: verify reverted");
        if (m == Mode.NonBoolean) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        }
        if (m == Mode.ShortReturn) {
            assembly {
                mstore(0, 1)
                return(0, 31)
            }
        }
        if (m == Mode.AlwaysFalse) return false;
        return signature.length == SIGNATURE_LENGTH && bytes32(signature[:32]) == tag(pubkey, message);
    }

    /// @notice The mock signature tag of `message` under `pubkey`.
    function tag(bytes memory pubkey, bytes memory message) public pure returns (bytes32) {
        return keccak256(abi.encode("mock-ml-dsa-87", pubkey, message));
    }
}
