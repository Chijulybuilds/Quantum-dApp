// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @title ConclaveProxy
/// @notice The address members, relayers and the app use: an unmodified OpenZeppelin
///         TransparentUpgradeableProxy, named so explorers show what it is.
/// @dev Deploy it with `initialOwner` set to the proxy's own (predicted) address: its ProxyAdmin is
///      then owned by Conclave, so only an executed post-quantum proposal can upgrade it.
///      `data` is the `Conclave.initialize` call, so deployment and initialization are atomic.
contract ConclaveProxy is TransparentUpgradeableProxy {
    constructor(address implementation, address initialOwner, bytes memory data)
        payable
        TransparentUpgradeableProxy(implementation, initialOwner, data)
    {}
}
