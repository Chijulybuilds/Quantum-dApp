# Conclave threat model

## Assets

1. The treasury: native QOR and ERC-20 tokens held by the contract.
2. Control of the DAO: the member set, the threshold and the guardian.
3. Liveness: members can always pass and execute proposals.

## Trust assumptions

- QoreChain's `pqcVerify` and `pqcKeyStatus` precompiles are correct, and the key registry only
  accepts a key with a valid proof of possession.
- ML-DSA-87 (FIPS 204) is not broken by quantum or classical computers.
- A majority of members keep their recovery phrases (from which both keys derive) safe.
- QoreX shows members the full message before they sign.

## Q-Day attacker

The attacker has recovered **every classical ECDSA key** involved: all members, the guardian and
the relayer. They have **no ML-DSA-87 key**. On QoreChain the classical key alone cannot open an EVM
window, but it can use any window that is already open, so the attacker can send EVM transactions
as any of these accounts within their open windows.

| Attempt | Result | Test |
|---|---|---|
| Propose a payout to themselves for a member | `PqcInvalidSignature`: no ML-DSA-87 signature | `test_QDay_ClassicalKeysCannotMoveFunds` |
| Vote from a member's own account | `PqcInvalidSignature` | `test_QDay_ClassicalKeysCannotVote` |
| Call `payERC20`, `addMember`, `setThreshold`, `setGuardian`, `unpause` directly | `OnlySelf` | `test_QDay_ClassicalKeysCannotMoveFunds` |
| Redirect a passed proposal's payout | `ProposalHashMismatch` | `test_QDay_TamperingWithAPassedProposalFails` |
| Replay signatures seen on chain on another proposal, DAO or chain | `PqcInvalidSignature` | `test_QDay_ReplayingObservedSignaturesFails` |
| Pause with the guardian's key | Succeeds **once**, for at most `pauseDuration` | `test_QDay_StolenGuardianKeyCanOnlyDelayOnce` |
| Keep pausing | `GuardianDisarmed` | same |
| Use the relayer's window to call another contract | Refused by the chain (window scoped to Conclave) | testnet evidence |

The invariant campaign repeats these attacks at random among honest activity and checks that the
attacker is never paid, no forged or unauthorised call ever succeeds, and the treasury balance
always equals deposits minus executed payouts.

## Threats and mitigations

| # | Threat | Mitigation | Tests |
|---|---|---|---|
| T1 | Forged signature | `pqcVerify` against the key from `pqcKeyStatus`; caller cannot supply a key | `Voting`, `QorePQC` |
| T2 | Vote reused on another proposal / support | Message names proposal id, hash and support | `test_RevertWhen_SignatureIsForAnotherProposal`, `test_RevertWhen_SupportFlipped`, fuzz binding |
| T3 | Replay on another Conclave or network | Message names DAO address and EVM chain id; prefix names native chain id | `...ForAnotherDao`, `...ForAnotherEvmChain`, `...ForAnotherNativeChain` |
| T4 | One key registered for two accounts | Message names the member | `test_RevertWhen_SharedKeyUsedForAnotherMember` |
| T5 | Propose signature replayed or used late | Per-member nonce and `valid until` | `test_RevertWhen_ProposeSignatureReplayed`, `...Expired` |
| T6 | Signature for one action used for another | `action:` field; fuzzed for collisions | `testFuzz_ActionsNeverCollide` |
| T7 | Compromised member key rotated or revoked | Key read on every check: old signatures stop working at once | `test_RevertWhen_KeyRotatedAfterSigning`, `...KeyRevoked` |
| T8 | Precompile inactive (e.g. mainnet), reverting or answering oddly | Fail closed: unavailable reverts; revert, short or non-boolean answers are invalid | `QorePQC` suite |
| T9 | Wrong key type or size registered | Algorithm id must be 1 (ML-DSA-87), key 2,592 bytes, signature 4,627 bytes | `QorePQC` fuzz tests |
| T10 | Content swapped between vote and execution | `proposalHash` checked at execution | `test_RevertWhen_ExecutedWithDifferentContent` |
| T11 | Re-entrancy from a payout target | Shared re-entrancy guard; `executed` set before calls | `test_RevertWhen_TargetReenters*` |
| T12 | Partial execution / gas griefing | All actions succeed or the call reverts | `test_FailedActionRevertsEverythingAndStaysReady` |
| T13 | Return-data bomb | Return data not copied on success | design (`_call`) |
| T14 | Calldata to an EOA "succeeds" | `TargetNotContract` | `test_RevertWhen_CalldataSentToAccountWithoutCode` |
| T15 | Token returns `false` | `payERC20` with `SafeERC20` | `test_RevertWhen_TokenTransferReturnsFalse` |
| T16 | Membership changes while votes are open | Epoch: older proposals become Stale | `test_ConfigChangeMakesOpenProposalsStale` |
| T17 | DAO bricked by an unreachable threshold | Strict majority checked after every change; new members must have a PQ key | `Governance` suite, fuzz on the initializer |
| T18 | Guardian holds the DAO hostage | One-shot fuse; `pauseDuration < gracePeriod`; members can rotate the guardian while paused | `Pause` suite, `testFuzz_PauseNeverOutlastsGrace` |
| T19 | Front-running relays | Duplicates skipped in `castVotes`; a front-run vote counts for the same member | `test_CastVotes_SkipsVotesAlreadyRelayed` |
| T20 | Unbounded loops | At most 64 members and 16 actions | `test_AcceptsMaxMembers`, `test_RevertWhen_AddingBeyondMaxMembers` |
| T21 | Phishing frontend shows one thing, asks to sign another | Members sign readable text naming the action, proposal, hash, DAO and chain | golden tests |
| T22 | Stolen upgrade key swaps the code (drains the treasury) | There is no upgrade key: the ProxyAdmin is owned by Conclave, so only an executed PQ proposal upgrades; blocked while paused | `test_RevertWhen_UpgradeNotFromDao` (fuzzed caller), `test_UpgradeBlockedWhilePaused`, `test_GovernedUpgrade_*` |
| T23 | Proxy or implementation initialized by an attacker | `initialize` runs in the proxy's creation transaction (OZ 5.7 requires init data); the implementation disables initializers | `test_RevertWhen_InitializedTwice`, `test_RevertWhen_ImplementationInitialized` |
| T24 | An upgrade corrupts state (storage collision) | ERC-7201 namespaced storage; layout pinned by a test; the upgrade is all-or-nothing inside `execute` | `test_StorageLayoutIsNamespaced`, `test_RevertWhen_UpgradeToNonContract` |

ML-DSA signatures are randomised, so several valid signatures exist for one message. Conclave never
uses a signature as an identifier (votes are recorded per member and proposal), so this is harmless.

## Residual risks

- **Compromised recovery phrase.** It yields both keys. A majority of members is still needed; a
  compromised member can be removed by the others, even while paused.
- **Colluding majority.** By design, a majority controls the treasury. The timelock gives the
  minority and the guardian time to react.
- **A malicious upgrade** is as powerful as a proposal paying out everything, and needs the same
  majority. Members should read upgrade proposals with care: the app labels them "Upgrade ·
  implementation → 0x…", and the new code should be verified on the explorer before voting.
- **Precompile bugs** are outside the contract's control. Every unexpected answer fails closed.
- **Keccak-256 and quantum computers.** Grover's algorithm leaves about 128-bit preimage security,
  which is considered adequate.
- **Mainnet.** The PQC precompiles are not active on mainnet yet; Conclave refuses to deploy
  without them (`initialize` checks every member's key).
