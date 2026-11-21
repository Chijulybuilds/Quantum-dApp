# Two-stage QCAI audit

The Post-Quantum dApp bounty asks for a two-stage QCAI audit: a first run, a response to every
finding, then a second run. Both reports are kept in [`docs/audit/`](audit/).

- **Setting:** "Ethereum (EVM/Solidity)" for both stages, so the reports can be compared.
  The "QoreChain (CosmWasm + PQC)" setting is for CosmWasm and reports a "mismatch" on Solidity.
- **Scope:** `contracts/src/Conclave.sol`, `contracts/src/libraries/QorePQC.sol`,
  `contracts/src/libraries/ConclaveMessages.sol`, `contracts/src/interfaces/*.sol`.
- **Quantum readiness "Not scored"** is expected with EVM settings. The post-quantum design is
  explained below instead.

## Stage 1

| | |
|---|---|
| Date | _YYYY-MM-DD_ |
| Commit | _hash_ |
| Report | [`docs/audit/stage-1.pdf`](audit/) |
| Score | _n_ |

| ID | Severity | Finding | Response | Fixed in / test |
|---|---|---|---|---|
| S1-01 | | | Fixed / Regression test / False positive (why) | |

## Stage 2

| | |
|---|---|
| Date | _YYYY-MM-DD_ |
| Commit | _hash_ |
| Report | [`docs/audit/stage-2.pdf`](audit/) |
| Score | _n_ |

| ID | Severity | Finding | Response | Fixed in / test |
|---|---|---|---|---|
| S2-01 | | | | |

## Post-quantum design (for the reviewers)

### Where the precompiles are called

| Call | In | Protects |
|---|---|---|
| `pqcKeyStatus` (0x…0a02) | `QorePQC.keyOf`, from `QorePQC.verify` | Reads the signer's registered ML-DSA-87 key; requires algorithm 1 and 2,592 bytes |
| `pqcKeyStatus` | `Conclave._addMember` (constructor and `addMember`) | No member without a usable key, so the threshold stays reachable |
| `pqcVerify` (0x…0a01) | `QorePQC.accepts`, from `QorePQC.verify` | Proves the signer approved the exact message |
| `QorePQC.verify` | `Conclave.propose` | Who may create a proposal, and its exact content |
| `QorePQC.verify` | `Conclave._castVote` (`castVote`, `castVotes`) | Every vote; reaching the threshold queues the payout |
| `QorePQC.verify` | `Conclave.cancel` | Only the proposer can withdraw their proposal |

### Tests that cover them

- `test/QorePQC.t.sol`: valid and invalid signatures; inactive, reverting, short and non-boolean
  precompile answers; unregistered keys, other algorithms, wrong lengths.
- `test/Conclave.Voting.t.sol`: binding of every message field; key rotation and revocation.
- `test/Conclave.QDay.t.sol`: an attacker with every classical key cannot move funds.
- `test-ffi/QoreSignDifferential.t.sol`: the bytes verified on chain are exactly what QoreSign signs.
- `scripts/pqc-check.ts`: the same Solidity code against the live testnet precompiles.

## Internal review before the QCAI audit

Issues found and fixed during development, for context:

| Issue | Fix | Regression test |
|---|---|---|
| Two accounts registering the same ML-DSA-87 key could share signatures | `member:` field in every message | `test_RevertWhen_SharedKeyUsedForAnotherMember` |
| A paused DAO could not remove a compromised member | Governance self-calls allowed while paused, without value | `test_Paused_GovernanceCanRemoveMember` |
| A payout could hide behind an `unpause` in the same proposal | Every action checked while paused | `test_Paused_BlocksPayoutHiddenBehindGovernanceAction` |
| Adding a member could need a specific order of actions | Configuration validated once after all actions | `test_AddMember_WithThresholdChange_InEitherOrder` |
| A front-runner could make a batch of votes fail | `castVotes` skips votes already counted | `test_CastVotes_SkipsVotesAlreadyRelayed` |
