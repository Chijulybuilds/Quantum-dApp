// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1967} from "@openzeppelin/contracts/interfaces/IERC1967.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {Conclave} from "../src/Conclave.sol";
import {IConclave} from "../src/interfaces/IConclave.sol";
import {ConclaveV2Mock} from "./mocks/ConclaveV2Mock.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

/// @notice Conclave behind a TransparentUpgradeableProxy: only an executed proposal can upgrade it.
contract ConclaveUpgradeTest is ConclaveTestBase {
    bytes32 internal constant STORAGE_LOCATION =
        keccak256(abi.encode(uint256(keccak256("conclave.storage.Conclave")) - 1)) & ~bytes32(uint256(0xff));

    ProxyAdmin internal admin;
    ConclaveV2Mock internal v2;

    function setUp() public override {
        super.setUp();
        admin = ProxyAdmin(conclave.proxyAdmin());
        v2 = new ConclaveV2Mock();
    }

    function _upgradeActions(address newImplementation, bytes memory migration)
        internal
        view
        returns (Actions memory a)
    {
        a.targets = new address[](1);
        a.values = new uint256[](1);
        a.calldatas = new bytes[](1);
        a.targets[0] = address(admin);
        a.calldatas[0] = abi.encodeCall(
            ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(address(conclave)), newImplementation, migration)
        );
        a.description = "Upgrade Conclave to v2";
    }

    // ---------------------------------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------------------------------

    function test_ProxyWiring() public view {
        assertEq(conclave.implementation(), address(implementation));
        assertEq(
            address(uint160(uint256(vm.load(address(conclave), ERC1967Utils.IMPLEMENTATION_SLOT)))),
            address(implementation)
        );
        assertEq(address(uint160(uint256(vm.load(address(conclave), ERC1967Utils.ADMIN_SLOT)))), address(admin));
        assertEq(admin.owner(), address(conclave), "the DAO owns its ProxyAdmin");
        assertTrue(conclave.upgradesGovernedByDao());
        assertEq(conclave.version(), "1.0.0");
    }

    /// @dev Pins the ERC-7201 layout: a future version must keep these fields where they are.
    function test_StorageLayoutIsNamespaced() public view {
        bytes32 timing = vm.load(address(conclave), STORAGE_LOCATION);
        assertEq(uint64(uint256(timing)), VOTING_PERIOD, "votingPeriod");
        assertEq(uint64(uint256(timing) >> 64), TIMELOCK, "timelockDelay");
        assertEq(uint64(uint256(timing) >> 128), GRACE, "gracePeriod");
        assertEq(uint64(uint256(timing) >> 192), PAUSE, "pauseDuration");

        // Slot 2 packs guardian (20 B), guardianArmed (1 B), pausedUntil (8 B) and threshold (2 B).
        bytes32 packed = vm.load(address(conclave), bytes32(uint256(STORAGE_LOCATION) + 2));
        assertEq(address(uint160(uint256(packed))), guardian, "guardian");
        assertEq(uint8(uint256(packed) >> 160), 1, "guardianArmed");
        assertEq(uint64(uint256(packed) >> 168), 0, "pausedUntil");
        assertEq(uint16(uint256(packed) >> 232), 2, "threshold");
        // Slot 3: epoch (4 B) and proposalCount (8 B). Slot 4: the members array length.
        assertEq(uint256(vm.load(address(conclave), bytes32(uint256(STORAGE_LOCATION) + 3))), 0, "epoch, proposalCount");
        assertEq(uint256(vm.load(address(conclave), bytes32(uint256(STORAGE_LOCATION) + 4))), 3, "members.length");
        // Nothing lives in the classic sequential slots.
        assertEq(vm.load(address(conclave), bytes32(0)), bytes32(0));
    }

    /// @dev Used directly (no proxy), there is no ProxyAdmin: nothing claims DAO-governed upgrades.
    function test_BareImplementationIsNotGoverned() public view {
        assertEq(implementation.proxyAdmin(), address(0));
        assertFalse(implementation.upgradesGovernedByDao());
    }

    function test_RevertWhen_InitializedTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        conclave.initialize(_founders(), 2, attacker, _timing(), NATIVE_CHAIN_ID);
    }

    function test_RevertWhen_ImplementationInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(_founders(), 2, attacker, _timing(), NATIVE_CHAIN_ID);
    }

    // ---------------------------------------------------------------------------------------------
    // Nobody but the DAO can upgrade
    // ---------------------------------------------------------------------------------------------

    function test_RevertWhen_UpgradeNotFromDao() public {
        address[5] memory callers = [alice, guardian, relayer, attacker, address(this)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, callers[i]));
            admin.upgradeAndCall(ITransparentUpgradeableProxy(address(conclave)), address(v2), "");
        }
        assertEq(conclave.implementation(), address(implementation));
    }

    function test_RevertWhen_UpgradeCalledOnProxyDirectly() public {
        // Only the ProxyAdmin reaches the proxy's upgrade function; anyone else falls through to
        // the implementation, which has no such function.
        vm.prank(attacker);
        vm.expectRevert();
        ITransparentUpgradeableProxy(address(conclave)).upgradeToAndCall(address(v2), "");
        assertEq(conclave.implementation(), address(implementation));
    }

    function testFuzz_RevertWhen_UpgradeNotFromDao(address caller) public {
        vm.assume(caller != address(conclave));
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(conclave)), address(v2), "");
    }

    // ---------------------------------------------------------------------------------------------
    // Governed upgrade
    // ---------------------------------------------------------------------------------------------

    function test_GovernedUpgrade_PreservesStateAndAddsFeatures() public {
        // History before the upgrade: one executed payout.
        Actions memory pay = _payout(grantee, 1 ether);
        uint256 paid = _passAndReady(pay);
        _execute(paid, pay);
        uint256 aliceNonce = conclave.proposeNonce(alice);

        Actions memory up = _upgradeActions(address(v2), abi.encodeCall(ConclaveV2Mock.initializeV2, ("post-quantum")));
        uint256 id = _passAndReady(up);
        vm.expectEmit(address(conclave));
        emit IERC1967.Upgraded(address(v2));
        _execute(id, up);

        ConclaveV2Mock upgraded = ConclaveV2Mock(payable(address(conclave)));
        assertEq(upgraded.version(), "2.0.0");
        assertEq(upgraded.implementation(), address(v2));
        assertEq(upgraded.motto(), "post-quantum", "migration ran");

        // Everything that was there is still there.
        assertEq(upgraded.memberCount(), 3);
        assertTrue(upgraded.isMember(alice) && upgraded.isMember(bob) && upgraded.isMember(carol));
        assertEq(upgraded.threshold(), 2);
        assertEq(upgraded.guardian(), guardian);
        assertTrue(upgraded.guardianArmed());
        assertEq(upgraded.votingPeriod(), VOTING_PERIOD);
        assertEq(upgraded.gracePeriod(), GRACE);
        assertEq(upgraded.nativeChainId(), NATIVE_CHAIN_ID);
        assertEq(upgraded.proposalCount(), 2);
        assertEq(upgraded.proposeNonce(alice), aliceNonce + 1);
        _assertState(paid, IConclave.ProposalState.Executed);
        _assertState(id, IConclave.ProposalState.Executed);
        assertEq(address(conclave).balance, TREASURY - 1 ether, "treasury kept");

        // Upgrades are still governed by the DAO, and the migration cannot run again.
        assertEq(admin.owner(), address(conclave));
        assertTrue(upgraded.upgradesGovernedByDao());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        upgraded.initializeV2("again");

        // The upgraded DAO keeps working: a new post-quantum payout goes through.
        Actions memory next = _payout(grantee, 2 ether);
        uint256 nextId = _passAndReady(next);
        _execute(nextId, next);
        assertEq(grantee.balance, 3 ether);
    }

    function test_UpgradeBlockedWhilePaused() public {
        Actions memory up = _upgradeActions(address(v2), "");
        uint256 id = _passAndReady(up);
        vm.prank(guardian);
        conclave.pause();

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 0));
        conclave.execute(id, up.targets, up.values, up.calldatas, keccak256(bytes(up.description)));
        assertEq(conclave.implementation(), address(implementation));

        // The pause is shorter than the grace period, so the upgrade can still run after it.
        vm.warp(block.timestamp + PAUSE);
        _execute(id, up);
        assertEq(conclave.implementation(), address(v2));
    }

    function test_RevertWhen_UpgradeToNonContract() public {
        Actions memory up = _upgradeActions(grantee, "");
        uint256 id = _passAndReady(up);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, grantee));
        conclave.execute(id, up.targets, up.values, up.calldatas, keccak256(bytes(up.description)));
        // All or nothing: still on v1 and still executable.
        assertEq(conclave.implementation(), address(implementation));
        _assertState(id, IConclave.ProposalState.Ready);
    }

    function test_RevertWhen_UpgradeWithoutQuorum() public {
        Actions memory up = _upgradeActions(address(v2), "");
        uint256 id = _propose(alice, up);
        _vote(id, alice, true); // 1 of the 2 votes needed
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        _assertState(id, IConclave.ProposalState.Defeated);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Defeated)
        );
        conclave.execute(id, up.targets, up.values, up.calldatas, keccak256(bytes(up.description)));
    }

    /// @dev The DAO may also freeze the code for good by renouncing the ProxyAdmin.
    function test_DaoCanFreezeUpgrades() public {
        Actions memory freeze;
        freeze.targets = new address[](1);
        freeze.values = new uint256[](1);
        freeze.calldatas = new bytes[](1);
        freeze.targets[0] = address(admin);
        freeze.calldatas[0] = abi.encodeCall(Ownable.renounceOwnership, ());
        freeze.description = "Freeze the implementation";
        uint256 id = _passAndReady(freeze);
        _execute(id, freeze);

        assertEq(admin.owner(), address(0));
        assertFalse(conclave.upgradesGovernedByDao());
        Actions memory up = _upgradeActions(address(v2), "");
        uint256 upId = _passAndReady(up);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(conclave)));
        conclave.execute(upId, up.targets, up.values, up.calldatas, keccak256(bytes(up.description)));
    }
}
