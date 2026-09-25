# Company-scoped approval controls

[Operations](README.md) · [Chains and keys](chains.md) · [Refreshing an approval](../architecture/outgoing-signing.md#refreshing-an-approval)

[#648](https://github.com/Ledova/ledova/issues/648) gave each company its own
on-chain `WhitelistRegistry` with an expiry the share token enforces on both
sides of every movement, made a revoked or expired classification reach the
chain, and put classification liveness in front of listing and acceptance.
This page records the evidence for
[product §5](../product.md#5-verification-and-transaction-controls): which
merged pull request supplies each required behaviour, which test on `main`
proves it, what the bypass review asked and answered, and what the
[fresh-start redeploy](chains.md#fresh-start-redeploy) rehearsal found. Every
test named here exists on `main` and passes; the commands that produced that
statement are in the pull requests.

Contract tests are Mocha names inside `contracts/test/`, run with
`npm --prefix contracts test`. Backend tests are `module.Class.method`, run with
the three [backend suites](../development/testing.md#backend-verification).

## The six required behaviours

| §5 behaviour | Where it is enforced | Merged | Test on `main` |
| --- | --- | --- | --- |
| Apply checks at relevant stages, including listing, acceptance and transfer | Order creation and swap signing check the account's live classification for the class's company; `ShareToken._update` checks the registry on every movement | [#702](https://github.com/Ledova/ledova/pull/702), [#701](https://github.com/Ledova/ledova/pull/701) | `tokens.tests.test_marketplace_stage_checks.ListingRequiresALiveClassificationTest.test_a_revoked_classification_records_the_eligibility_refusal`; `...AcceptanceRequiresALiveClassificationTest.test_a_party_whose_classification_was_revoked_cannot_accept`; `...test_a_relayed_signature_is_judged_by_whose_signature_it_is`; `ShareToken` → `Sender checks` → "Should refuse a direct transfer from a removed sender" |
| Bind approvals to the correct participant, company, wallet and action; enforce expiry, revocation and protection against reuse | The factory keys one registry per ACN; a change carries its company, address, action and expiry, bound into the exact `setExpiry` calldata by a database trigger; `isWhitelisted` is `expiresAt > block.timestamp` | [#701](https://github.com/Ledova/ledova/pull/701) | `ShareTokenFactory` → `Cross-company isolation` → "Should grant nothing on company B's token for an approval in company A's registry"; `WhitelistRegistry` → "Should stop listing an address once its expiry has passed"; `whitelist.tests.test_change_recovery.WhitelistChangeRecoveryTest.test_each_company_keeps_its_own_approval_row_and_registry`; `whitelist.tests.test_change_migration.WhitelistChangeMigrationTest.test_the_guard_binds_the_expiry_into_the_registry_call`; `whitelist.tests.test_entry_scoping.WhitelistEntryScopingTest.test_operator_pending_retry_preserves_identity_and_refuses_opposite_command` |
| Enforce rules on direct contract calls and delegated transfers; check administrative and recovery paths for bypasses | `_update` is the single enforcement point, so a direct call, a delegated transfer and a swap settlement all meet it; the backend's four write authorities each check their own actor | [#701](https://github.com/Ledova/ledova/pull/701), this slice | `ShareToken` → `Sender checks` (four cases); `Approval bypasses` (whole file); `whitelist.tests.test_bypass_paths` (whole file) — see [the bypass review](#the-bypass-review) |
| Refresh affected permissions when evidence or restrictions change, with documented update delays | Revocation, renewal and suspension enqueue a refresh under the deciding staff member; wallet deletion retains a removal job attributed to its holder or staff actor. The approval sweep covers surviving rows; removal jobs retry every five minutes after their rows disappear. The normal update window is fifteen minutes | [#702](https://github.com/Ledova/ledova/pull/702), removal recovery under [#648](https://github.com/Ledova/ledova/issues/648) | `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_a_revoked_claim_removes_the_approval_and_a_second_refresh_submits_nothing`; `...test_the_sweep_submits_under_the_staff_member_whose_review_decided_it`; `...test_revoking_a_claim_enqueues_the_refresh_for_the_reviewer`; `whitelist.tests.test_change_scoped.ScopedWhitelistChangeTest.test_deleted_wallet_removal_job_survives_pending_add_then_removes_its_late_confirmation` |
| Hold affected actions when required checks are stale, unavailable or unresolved, with review and recovery procedures | A screening result without a valid risk score leaves the screening pending rather than approving it; a failed removal reads as not approved and is resubmitted; an unreadable registry reads `unknown`, never `whitelisted`; an unresolved change blocks the opposite command until recovery finishes | [#700](https://github.com/Ledova/ledova/pull/700), [#701](https://github.com/Ledova/ledova/pull/701), [#702](https://github.com/Ledova/ledova/pull/702) | `compliance.tests.test_crypto_screening_results.ProviderWithoutScreeningTest.test_a_provider_that_cannot_screen_fails_and_raises_the_monitoring_flag`; `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_a_failed_removal_reads_as_not_approved_and_is_resubmitted`; `whitelist.tests.test_status_view.WhitelistInvestorStatusServiceTest.test_a_chain_error_is_reported_as_unknown_rather_than_a_refusal` |
| Resolve mistaken identity matches and expired restrictions through an accountable correction process | Every change names one of four authorities and the person who submitted it; neither is editable afterwards, and the database refuses an authority outside the four; a refresh is attributed to the reviewing staff member, and a change no actor explains is listed for staff rather than written | [#701](https://github.com/Ledova/ledova/pull/701), [#702](https://github.com/Ledova/ledova/pull/702), this slice | `whitelist.tests.test_change_scoped.ScopedWhitelistChangeTest.test_admin_confirmation_preserves_identity_across_repeated_posts`; `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_the_sweep_lists_a_row_no_actor_explains_rather_than_writing_it`; `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_the_database_refuses_moving_an_admitted_change_to_another_authority` |

§5 also asks that screening providers be replaceable while effective
restrictions are preserved. Only the KYCAID adapter implements crypto
screening; the base adapter raises. [#700](https://github.com/Ledova/ledova/pull/700)
made a provider that cannot screen fail the screening and raise the monitoring
flag rather than approve it, which is what replaceability has to preserve:
`compliance.tests.test_crypto_screening_results.ProviderWithoutScreeningTest.test_a_provider_that_cannot_screen_fails_and_raises_the_monitoring_flag`.

## What these controls do not do

- **A removal reaches the chain in minutes, not at once.** Between a revocation
  and its removal landing, a direct contract call can still move shares. Every
  platform path refuses in that window; the chain does not. Pausing the token
  is the incident lever.
- **Owner power is trusted, not checked.** The operator key owns every registry
  and token. Renouncing either ownership freezes it for good, and the swap
  moves any token its owner approves, whether or not the factory created it.
  The tests below record those consequences; no contract prevents them.
- **A burn is not a transfer.** A holder whose approval lapsed can still burn
  their own shares, and a spender they authorised earlier can still `burnFrom`
  them. Reconciliation reports the burn.

## The bypass review

§5 asks that administrative and recovery paths be checked for bypasses. These
are the cases the review asked, the answer each has, and the test that holds
it. "Existing" means the case already had a test when this slice started;
"new" means this slice added it.

### On chain

| Case | Answer | Test | |
| --- | --- | --- | --- |
| Direct `transfer` from an expired holder | Refused | `ShareToken` → "Should refuse a direct transfer from an expired sender" | existing |
| Direct `transfer` from a removed holder | Refused | `ShareToken` → "Should refuse a direct transfer from a removed sender" | existing |
| Delegated `transferFrom` out of an expired holder | Refused | `ShareToken` → "Should refuse a delegated transferFrom out of an expired holder" | existing |
| Delegated `transferFrom` out of a removed holder | Refused | `ShareToken` → "Should refuse a delegated transferFrom out of a removed holder" | existing |
| `burnFrom` by an approved spender against an expired holder | **Allowed**: the burn sends to nobody, so `_update` has no recipient to check, and the holder granted that allowance while approved | `Approval bypasses` → "Should let an approved spender burnFrom an expired holder, because the burn sends to nobody and the holder granted the allowance" | new |
| The same spender's `transferFrom` of the same shares | Refused | `Approval bypasses` → "Should refuse the same spender a transferFrom of the same shares" | new |
| `burnFrom` without an allowance | Refused | `Approval bypasses` → "Should refuse a burnFrom without an allowance" | new |
| A removed holder burning their own shares | Allowed, by the owner's decision; reconciliation reports it | `ShareToken` → "Should still let a removed holder burn their own shares" | existing |
| Mint to a recipient with no approval | Refused | `ShareToken` → "Should revert when minting to non-whitelisted address" | existing |
| Mint in the second the recipient's expiry names | Refused | `ShareToken` → "Should refuse a mint in the second the recipient's expiry names" | existing |
| Transfer in the last second a party's approval names | Allowed | `ShareToken` → "Should let a sender transfer in the last listed second", "Should let a recipient receive in the last listed second" | existing |
| Transfer in the second a party's expiry names | Refused | `ShareToken` → "Should refuse a sender in the second its expiry names", "Should refuse a recipient in the second its expiry names" | existing |
| Swap settlement with a seller who was never approved, or whose approval expired | Refused, both nonces preserved | `AtomicSwap` → `Whitelist validation by the share token` (three cases) | existing |
| Swap settlement with a removed seller, and with a removed buyer | Refused, the nonce preserved | `Approval bypasses` → "Should refuse settlement when the seller's approval was removed", "...when the buyer's approval was removed" | new |
| Swap settlement with an expired buyer | Refused, and no payment moves | `Approval bypasses` → "Should refuse settlement when the buyer's approval expired" | new |
| Swap settlement in the last listed second, and in the second an expiry names | Settles, then refused | `Approval bypasses` → "Should settle in the last second a party's approval names", "Should refuse settlement in the second a party's expiry names" | new |
| An approval in one company's registry, used on another company's token | Grants nothing | `ShareTokenFactory` → `Cross-company isolation` (three cases) | existing |
| The same, through a swap settlement | Grants nothing | `Approval bypasses` → "Should refuse settlement of one company's token for parties approved only by another" | new |
| Two classes of one company | Share one registry: one approval covers both, one removal freezes both, and another company's classes are untouched | `ShareTokenFactory` → "Should bind two classes of one company to the same registry"; `Approval bypasses` → "Should refuse both of a company's classes once its one approval is removed", "Should grant nothing on either of a company's classes for an approval held only elsewhere" | existing and new |
| `setExpiry` by anyone but the registry's owner, including the factory's owner | Refused | `WhitelistRegistry` → `Owner-only writes` (three cases); `ShareTokenFactory` → "Should refuse registry writes from the factory owner when it does not own the token" | existing |
| A paused token: transfer, mint, delegated transfer and burn | All refused | `ShareToken` → `Pause/Unpause` (four refusals, and one case for unpausing) | existing |
| A paused token: swap settlement | Refused, and settles again after unpausing | `Approval bypasses` → "Should stop a swap settlement while the share token is paused" | new |
| `pause` by anyone but the token's owner | Refused | `Approval bypasses` → "Should refuse a pause from anyone but the token owner" | new |
| `renounceOwnership` on a registry | **Freezes it for good**: no approval can be renewed or granted again, so every approval can only lapse and every holding freezes with it | `Approval bypasses` → "Should leave a registry unwritable for good, so approvals can only lapse" | new |
| `renounceOwnership` on a token | **Freezes minting and the pause lever for good**, while the registry still governs transfers | `Approval bypasses` → "Should leave a token unmintable and unpausable for good, while its registry still governs transfers" | new |
| A token the factory did not create, approved on the swap by its owner | **Moves with no approval check**, because the swap relies on the token's own `_update`; a `ShareToken` deployed outside the factory still enforces the registry it was given | `Approval bypasses` → "Should move an approved payment token between unapproved parties, because no registry governs it", "Should still enforce its own registry for a share token deployed outside the factory" | new |

The backend never approves a share token the factory did not create: a swap
approval is built from a `TokenDeployment`, and a deployment whose factory is
not the configured one is never projected. That is a backend rule, not a
contract one.

### In the backend

| Case | Answer | Test | |
| --- | --- | --- | --- |
| The operator API, reached by a non-staff user, a superuser who is not staff, or anonymously | Refused on every route and method, before the whitelist service is touched | `whitelist.tests.test_entry_scoping.WhitelistEntryScopingTest.test_nonoperators_cannot_use_operator_routes`, `...test_anonymous_cannot_use_operator_routes` | existing |
| A whitelist admin row action by staff without the change permission | Refused before the row is resolved | `shared.tests.test_admin_row_actions.AdminRowActionAuthorizationTest` (six cases) | existing |
| The whitelist admin's bulk chain actions, for staff who may only view | Withheld | `whitelist.tests.test_bypass_paths.WhitelistAdminActionAuthorityTest.test_the_chain_actions_are_withheld_from_staff_without_the_change_permission` | new |
| The whitelist admin's sync action, for staff who may only view | Available, and it grants nothing: it copies the chain's answer into the mirror and submits no change | `whitelist.tests.test_bypass_paths.WhitelistAdminActionAuthorityTest.test_the_sync_action_copies_the_chain_and_grants_no_approval` | new |
| The subscription admin's whitelist action, for staff who may only view | Withheld | `whitelist.tests.test_bypass_paths.WhitelistAdminActionAuthorityTest.test_the_subscription_action_is_withheld_from_staff_without_the_change_permission` | new |
| A staff member holding only `offerings.change_subscription`, submitting under the whitelist-admin authority | Refused; the same person succeeds under the subscription authority | `whitelist.tests.test_change_recovery.WhitelistChangeRecoveryTest.test_whitelist_and_subscription_permissions_are_separate` | existing |
| A staff member whose standing is revoked after a change was admitted | No new change is admitted; the admitted one still recovers under its original actor | `whitelist.tests.test_change_recovery.WhitelistChangeRecoveryTest.test_staff_revocation_prevents_admission_but_does_not_cancel_accepted_recovery` | existing |
| A wallet's own holder adding an approval under the refresh authority | Refused; the same holder's removal succeeds | `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_a_holder_can_only_remove_through_the_refresh_authority` | existing |
| The same, reached through the refresh service and through a refresh target rather than a direct submission | Refused, nothing broadcast, and the target counted as an error; the same refresh under a staff actor restores the approval | `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_a_holder_cannot_be_added_back_through_the_refresh_they_can_only_remove_with`, `...test_a_holders_refresh_target_is_counted_as_an_error_rather_than_written` | new |
| An authority outside the four entry points | Refused by the service, and refused by the database even if the service gate were widened | `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_an_authority_outside_the_four_entry_points_never_reaches_the_chain`, `...test_the_database_refuses_an_authority_the_service_gate_would_let_through` | new |
| Moving an admitted change to another authority | Refused by the database | `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_the_database_refuses_moving_an_admitted_change_to_another_authority` | new |
| The sweep, when the reviewer it would act for is no longer staff or no longer active | Listed as unattributed and not written; restoring the reviewer lets the same sweep submit | `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_the_sweep_will_not_write_under_a_reviewer_who_lost_their_staff_standing` | new |
| The refresh task, given an actor that no longer exists | Writes nothing | `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_the_refresh_task_writes_nothing_for_an_actor_that_no_longer_exists` | new |
| Whitelist commands attempted on the application connection | Refused, and the command rows are unreadable there | `whitelist.tests.test_change_scoped.ScopedWhitelistChangeTest.test_app_alias_cannot_admit_recover_or_read_private_commands` | existing |

## The fresh-start redeploy rehearsal

The [fresh-start redeploy](chains.md#fresh-start-redeploy) was rehearsed on a
local Hardhat node on 23 September 2026, against `598327e7`. The record below
is what ran, what it answered and what the runbook had to change.

| Step | What ran | Result |
| --- | --- | --- |
| 1. Stop the backend and workers | Nothing was running in the rehearsal | Not exercised |
| 2. Deploy the core contracts | `npx hardhat node --port 8552`, then `LOCALHOST_RPC_URL=http://127.0.0.1:8552 npm --prefix contracts run deploy:local:core` | Factory, AUDY and AtomicSwap deployed; the three addresses written to `.deployed-contracts.env` |
| 3. Reset the database | `DROP DATABASE`/`CREATE DATABASE`, then `python manage.py migrate`, `check_rls_roles`, `check_rls_catalogue` from `backend/` | All three passed: 87 tables reachable by the scoped role, 224 policies across 56 tables |
| 4. Set the three addresses | The addresses from `.deployed-contracts.env`; `backend/.env.example` already carries no `WHITELIST_CONTRACT_ADDRESS` | Accepted |
| 5. Recreate companies and users | `python manage.py createsuperuser --noinput` | Superuser created; the browser steps were not driven in this rehearsal |
| 6. Deploy each share class | Not reachable: outgoing signer admission is closed by design and has no activation command | Blocked; see below |
| 7. Approve wallets per company | Not reachable for the same reason | Blocked; see below |
| 8. Verify | The five commands the runbook now lists | Each ran and answered; see below |

**What the rehearsal changed in the runbook.**

1. **Signer admission is a prerequisite, and it is closed.** Steps 6 and 7 both
   write to the chain through the
   [outgoing signing foundation](../architecture/outgoing-signing.md), whose
   admission is closed for every signer and has no activation command or admin
   surface. On a new database no share class can be deployed and no approval
   written until the owner directs otherwise. The runbook now says so before
   step 6 instead of reading as though those steps always work.
2. **Step 2 did not say to start a node.** It now names `npx hardhat node` and
   the `LOCALHOST_RPC_URL` the deployment reads.
3. **Step 3 did not say where to run `manage.py`.** It now says `backend/`, and
   points at the role-authentication note a brand-new cluster needs.
4. **Step 8 was prose.** Its five checks are now five commands, each of which
   answers on the console.
5. **The fresh start is what makes the migration guard sufficient.** The
   `whitelist/0007` guard refuses a database that holds whitelist changes
   written for the retired global registry, but a database with deployed share
   classes and no such rows would pass it. The runbook now says the database
   must be a new, empty one, and the last step-8 check is what catches a
   database still carrying classes from retired contracts.

**Step 8's checks, with what they answered.** Because steps 6 and 7 were
blocked, the rehearsal put the state there another way: it called the factory
directly with the operator key to create three classes for two companies,
approved one wallet in the first company's registry, and wrote the matching
company, class, wallet and approval rows through the ORM. That is a stand-in
for what the platform would have recorded, not a demonstration that it does.
Each check was then run, and the state mutated to confirm the check can answer
the other way.

| Check | Answer | Mutation, and what it then answered |
| --- | --- | --- |
| The configured chain id matches the node | `31337` | With `BLOCKCHAIN_CHAIN_ID=84532`: `Refusing EVM endpoint on chain 31337; expected chain 84532` |
| Each class's `whitelist()` equals its company's `registryOf(acn)` | `AORD True`, `APREF True`, `BORD True` | Repointing one class's row at the other company: `AORDX False` |
| A wallet approved for one company is refused another company's class | `BORD False` | Approving the same wallet in the second registry: `BORD True` |
| The refresh sweep reports whether it can attribute and submit a change | `{'checked': 1, 'submitted': 0, 'unattributed': 1, 'errors': 0}`, with the unattributed row logged | Not mutated; the unattributed case is proved by `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_the_sweep_lists_a_row_no_actor_explains_rather_than_writing_it` |
| No class has a deployment whose factory differs | `[]` | Not mutated |

The isolation fixture approved the control wallet only in company A. Adding a
separate approval in B legitimately changes B's answer to `True`; it does not
make A's approval apply to B. The current runbook requires those explicit
fixtures and refuses missing classes or a shared registry. The sweep's
historical counters above report an unattributed change, not a successful
removal or an on-chain confirmation.

Steps 6 and 7 are performed against a real node, with an admitted test signer,
by the real-chain suite: `make chain-test` deploys a class through
`tokens.services.deployment` and writes approvals through
`whitelist.services.changes`, and
`tokens.tests.test_chain_integration.WhitelistChangeChainTest` and
`ShareTokenChainTest` assert the registry binding and the expiry the chain
enforces. That is the evidence for those two steps until signer admission is
opened.

### Base Sepolia

The authorised core deployment and fresh signer admission completed on
**25 September 2026**, on public Base Sepolia, chain **84532**. The backend,
worker and dashboard run locally; this is not a hosted production deployment.
The [rollout checkpoint](https://github.com/Ledova/ledova/issues/648#issuecomment-5835262968)
and the later public observations below record progress, **not closure of
#648 or public release acceptance**.

Checkpoint cutoff: **25 September 2026, 18:24:17 UTC**.

| Public acceptance proof | State at this checkpoint |
| --- | --- |
| A/B deployment and registry bindings | Both projected; four canonical successful deployment/approval receipts finalized and the complete DB deployment inventory targets only the configured factory. Later finalized control observations also rechecked both factory/registry/token bindings |
| A-only C/I grants and positive controls | Both normal grants confirmed, both canonical receipts finalized and both finalized positive membership/direct-call baselines retained before revocation |
| I classification revocation | Normal API denial observed; the periodic-fallback removal finalized, with a canonical block timestamp approximately 534.5 seconds after revocation and before original expiry. Finalized A/B membership and direct-call refusals retained |
| C natural expiry | Real chain time passed the original 18:00 UTC expiry. Finalized A/B membership is false and both direct-call simulations refuse C, while A still stores the original nonzero expiry and B stores zero |

| Field | Recorded value |
| --- | --- |
| Original contract source/build | Frozen artifacts from reviewed `b76c69c2`, merged as `7a4d58cb` in [#728](https://github.com/Ledova/ledova/pull/728); the later backend fixes retain these contracts and artifacts |
| Current backend/worker | Source `32d161dcd269df1f1d5534ecc80ffb90e685e2f6`; [#734](https://github.com/Ledova/ledova/pull/734) merged as `3f9cf5ae`, with the same tree as the candidate and CI checkout |
| Deployer/operator | `0x4A0DC41A44fA101d13e85CC4C10aE24aA165C290`, a dedicated software testnet signer; no physical Keystone claim |
| `ShareTokenFactory` | `0xbe30d6790FDB765a0AcaE78cCCa72cFB62B9bCDd` |
| `AtomicSwap` | `0xD0A6cA2BF4C074dDb91d850721a0F431ED877Ee4` |
| `AUDY` | `0x030C3408F2456e71b66284DBCCB16ae674c83C84` |
| Finality and admission | All five core transactions below were successful, canonical and finalized at the retained 10:43:21 UTC observation, finalized head `47281832`. After [#729](https://github.com/Ledova/ledova/pull/729), fresh signer admission opened generation 1 at nonce 5; exact replay returned `unchanged=true` |

| Core transaction | Hash | Block |
| --- | --- | --- |
| Create factory | `0x786d7023f05f75ee5a9e17c1697338d6d421086d32e210ba95052bab51121bef` | 47281406 |
| Create AUDY | `0xf26e3a38440e4a4cbabc904b76f50891925bcfa92ea819e8d144f33e84b85bbb` | 47281407 |
| Add AUDY minter | `0xb36a85e38dfc11a7f51d8fb2949008433524d05aa2710064c778b1d8b6a4d23f` | 47281408 |
| Create swap | `0x1503800d128dc4f502372d37b211e0befcc39838b70c5032696495cfef832800` | 47281409 |
| Approve AUDY payment token | `0xf65d1cfd571e6683c70971de15b6290da6d6c17311695b9c6bdf137b258c3156` | 47281703 |

The original script stopped after nonce 3 on an RPC read; a reviewed bounded
continuation sent only the missing nonce-4 approval. Read-only reconciliation
published the five-hash manifest without restarting deployment. The later
admission audit independently checked all five finalized observations.
[#734 CI](https://github.com/Ledova/ledova/actions/runs/36152565939) passed:
ordinary shards reported 5,205 tests, including 732 specialized skips; scoped 646 and
local-EVM 80 passed without skips. Native scope/check gates passed; this backend-only run skipped
native builds. These checks do not replace public-chain acceptance.

The owner authorised two explicitly fictional companies: A, ACN `999000001`,
class `FXA648`, and B, ACN `999000010`, class `FXB648`, each with 1,000 authorised
shares. Fixture setup activated the companies without ABR verification,
completed signup, and set only the software investor's synthetic identity
prerequisite. It did not assert real company registration, KYC, email
verification or legal acceptance; terms acceptance remains false. The synthetic
professional-investor claim began submitted without expiry or review. At
16:19:37 UTC, normal staff verification set expiry to 20:35 UTC with explicit
synthetic-only review notes: no real KYC evidence, legal declaration or investor
qualification is asserted. The two issuers and software investor proved wallet ownership through the normal
authenticated EIP-191 challenge/signature/readback flow. The separate Keystone
participant received no fixture wallet or ownership-verification override.
These are fresh fixture identities: no issued holdings or populated register
was created, and no old register was carried over.

| Company | Recorded class and recovery state |
| --- | --- |
| A | `0x1C01c83a491d2De1A682E693eA911bE12a11415C`; original deployment nonce 5, transaction `0xcead30e3bb5726170c43fc923c0e5c5eb2fe51ab0109bb4cfb49c3388d2f990f`, block `47287748`; swap approval nonce 6, transaction `0xc72d2ee643f000861a0d14389d288f079cfe126e888f2aa2f16927b053f18a3f`, block `47287750`; both projections confirmed, with approval recorded at 15:45:00.782972 UTC during normal approval recovery |
| B | `0x4016dB3d817ce37151596f696afC039F832a7B24`; the normal retry retained the original deployment and operation. Deployment nonce 7, transaction `0xfb9dc0dd34622116456363903aae3d547816aaad37681edcdfe38a3ecb62d849`, block `47291343`, projected at 15:55 UTC. Swap approval nonce 8, transaction `0xc75aaeb82ab0c6bc578485ee457b2a2f4f0155a36b02bf66fe50b33a9d135ad0`, block `47291710`, confirmed at 16:10:02.310 UTC in readback 07 |

The 16:22:15 UTC public deployment proof rechecked all four successful canonical
receipts, including exact senders, nonces, calldata and events. All four blocks
were below observed finalized head `47291776`. At pinned latest block
`47292515`, factory mappings, token registry bindings, code, owner/share terms
and swap approvals matched. A's registry is
`0x88d215019f592db70de263af4baba97025064002`; B's distinct registry is
`0x9fff97e65891d4be6c5ba68200d5d838c0e4ca73`. This pinned latest state was
**not itself finalized**; receipt finality does not establish that stronger claim.
The later finalized control observations below also rechecked factory registry
mappings and token registry bindings. The original deployment proof's additional
owner/share-term and swap-approval reads remain observations of its latest block.

The read-only step-8 database inventory at 16:42:24 UTC contains exactly the
expected A and B deployment records, with matching token/company identities,
class addresses and factory target. The literal
`exclude(contract_address='').exclude(intent__to=settings.SHARE_TOKEN_FACTORY_ADDRESS.lower())`
UUID list is `[]`. Evidence
`deployment-inventory-20260925T164222Z.json`
has SHA-256 `e190a326efa679bdb2997f6538fe4bbcb561dd48cb685f7090a4c1f1c4b65f51`.

After the backend fix, a separately reviewed keyless repair rechecked A's
original canonical receipts/events and corrected exactly three zero
`block_hash` columns. It preserved the original attempts, claims, timestamps,
nonces and other fields; replay returned `already_corrected_no_writes`.
A's original approval projection subsequently completed during normal approval
recovery; this is a timestamp correlation in the retained audit. B's approval
projection also completed. The B retry added one job and replay added none.
Neither repair nor enqueue helper signed
or broadcast a transaction; the normal worker signed B's attempts.

Retained operator evidence includes `public-finality.json`,
`public-admission-complete.json`, the fictional fixture execution summary,
the software ownership record (SHA-256
`ba2e444a54c2d06c30c6c745f82e8d95eef825cd2e5cb9b765efeb86153929e8`),
and the metadata repair and normal retry records.
A's completed projection is in `snapshot-20260925T1551.json`
(SHA-256 `a56d1ebf7c8b9fc81d33e267d246d5c5c44c8ab6bdea181c123a59be56e60e3e`).
The completed B snapshot is `readback-07.json`, SHA-256
`1aaf5619df7aadfea18b4ba8f3034e37f8edf0aa42cbfce18f9d9d5a682e9b71`.
Public proof `deployments-canonical-03.json`
has SHA-256 `9b9e771ba446b9ccb12c792ca94280fd23129aeed49f386f26e86aa6ee3fdb0f`.
Database, API and worker observations rely on retained operator audits; their
digests identify files whose contents are not committed here. Public chain
observations can be checked from the addresses, transactions and blocks below.

| Control | Public test wallet |
| --- | --- |
| C, independent expiry control | `0x63C4412edE96aB82D69301706BB511Be48294dD8` |
| I, synthetic investor revocation control | `0x082aECc520291972b5deFded32eb1AB895bf96B3` |

The independent A-only controls overlapped while awaiting finality. C's normal
staff grant confirmed at 16:25 UTC with original expiry **18:00 UTC**, nonce 9,
transaction
`0x398f22c1d2b4b2fe432143d6d91b09721305d47b8f4be153d53eff938be08458`,
block `47292537`. I's grant was requested through normal staff HTTP at 16:32 UTC
while C awaited finality, and confirmed at 16:35:02 UTC with original expiry
**20:35 UTC**, matching the synthetic classification. I's original transaction
is `0x42f2d1954b5569e977f9eef2580fab889a3926ad235e0883d5b6880067e072e0`,
nonce 10, block `47292837`. `grants-c-i-canonical-01.json` binds both canonical
successful receipts to the original staff operations, expiries and events;
the later `grants-c-i-finalized-01.json` at 16:55:22 UTC puts both below observed
finalized head `47292917` (SHA-256
`5d260d4047db7322e5ba951b1a8a6047cb95d291b36167a069ae76bb76bd9e3a`).

C's positive finalized baseline was retained at 16:41:58 UTC in
`c-baseline-finalized-01.json`, SHA-256
`2eeb99961b3ff5ebf1a65b4406942ee25dee6a377ef625a36a18bb9fc882aba9`.
At finalized block `47292664`, hash
`0x69e0b765e829a00d0922957f67d153e892dfbce470eddfebc47cc5444ae711ee`,
timestamp `1790353616`, C was approved in A and
absent in B. Zero-value self-transfer `eth_call` simulations succeeded in A and
returned `SenderNotWhitelisted(C)` in B. I's finalized positive baseline is
also retained, before revocation, at 16:55:22 UTC in
`i-baseline-finalized-01.json`, SHA-256
`7fa42bca8957c638417b3d30f5c6c8bfe6dd8f1a1fa5d90e262807cbc539d793`:
at finalized block `47292917`, hash
`0x5f24fc9b96bc75d6a6bde9beccfad6937a40e2282fd999fe6525480cf6cee16b`,
timestamp `1790354122`, A approved I and B did
not; the same simulations succeeded in A and refused I in B. These records and the confirming readback
`staff-audit-after-grant-i-02.json` (SHA-256
`bb4f78f3c90fd98b09a3c3c088047b4ed6bf7977a8bc9423a65fe61cf5b20f5d`)
are retained with the public acceptance evidence. To reproduce a guard check,
verify the numbered block's hash, read each registry's membership for the
control wallet, and `eth_call` each token's `transfer(wallet, 0)` from that same
wallet at that block. Simulations prove the guard at the recorded state; they
are not mined transfers or physical-wallet proof.

Normal staff revocation took effect at **16:56:11.525869 UTC**, retaining I's
original 20:35 UTC expiry. The normal eligibility read returned false 0.272
seconds later. `market-before-01.json` and `market-after-01.json` show A's detail
and order-book API responses changing from 200 to 404 and the market token list
becoming empty. These are authenticated API observations, not browser UI proof.

| Retained API evidence | SHA-256 |
| --- | --- |
| Normal staff revoke HTTP record | `0bdf6d774e3192d5b97f2f96fd4b3be1e1ba3c746280b70f34b8a02e925cbdb3` |
| `market-before-01.json` | `ef56c397f00493cde543bc65bd0acae0792dd942d18bfb4f1cc055c68f08f9ee` |
| `market-after-01.json` | `a8a89c576b0a249eec1157f0fa8c2b1fe37d3e472a948de74c89364bfefb394f` |

The targeted refresh and 17:00 periodic sweep encountered
registry-read errors and admitted no removal. Preserve these failed refresh
attempts. The suppressed exceptions do not establish their underlying cause.
The normal 17:05 periodic sweep admitted and signed I's removal; the 17:10
recovery confirmed its projection. `revoke-after-01.json` supports this conservative job-window
correlation using the scheduler link retained in an intermediate snapshot,
not a job-to-change foreign key or proof of transaction commit ordering
(SHA-256 `df27a0b9266dbf315c83a9fe380ddc8275baebcf69db1c7b54fc68f392551f18`).

`removal-receipt-finality-02.json` independently verifies successful canonical
`setExpiry(I,0)` transaction
`0x2873e579c818d26795f96368cf3840573c1a7eb1a54f95ddc4bebbc81c4940b3`,
nonce 11, block `47293809`, hash
`0x6a194d12a9569be552f7dd8ab13b21366efa6bb4b0a97a17bee698123e2c7d57`,
timestamp `1790355906` (17:05:06 UTC). Its interval from revocation is
**approximately 534.5 seconds**, below fifteen minutes and strictly before the
unchanged original expiry; this is removal evidence rather than natural expiry.
The first 17:12 observation was provisional. The 17:28:33 UTC receipt recheck
establishes finality at observed finalized head `47293954`, hash
`0xef4cda3ca0755eeb7b3942ea5bc07b5d2dc9a7f089ccbbd6e966fdb792747da5`,
timestamp `1790356196` (evidence SHA-256
`74e06fc769451409fd5a77fa94a794f5fbecc89d41ed04bb5bb3e94a192e4ed4`).
`i-removed-finalized-01.json` at 17:28:53 UTC checks that same finalized block:
both registry expiries are zero, membership is false in A and B, and both
zero-value self-transfer simulations return `SenderNotWhitelisted(I)`
(SHA-256 `0efc077aa4ea0a4662c077271f0c77a454cab678a2547da7b566c2f095c456cc`).
No positive-amount transfer, mined reverting transfer or hardware signature was
performed.

C's natural-expiry control completed after real public-chain time passed its
original **18:00 UTC** expiry, timestamp `1790359200`. The first observation,
`c-expired-latest-01.json`, at 18:01:04 UTC recorded latest block `47295485`, hash
`0x8751ff7fafd24bb230086a3dce4e9891e8a0eba682fbcd3cecc2830fd1337db5`,
timestamp `1790359258` (18:00:58 UTC), with evidence SHA-256
`2a1371f929edf2572519bde02bfee43bdf2fb32173560b72a848fbd402587c80`.

The finalized check, `c-expired-finalized-01.json`, at 18:24:17 UTC recorded
block `47295622`, hash
`0x45ef42a51fc2d0adff1467911221010f256dceb55b10081e4fc1e72d71e3d08f`,
timestamp `1790359532` (18:05:32 UTC), with evidence SHA-256
`7dcc3f458818f002b169fdc7c0611d18907571ca46b9bc1f58e69ba6e1fef997`.
Both observations retained A's original nonzero expiry `1790359200` and B's
zero expiry, while both memberships were false and both zero-value self-transfer
simulations returned `SenderNotWhitelisted(C)`. The finalized observer also
rechecked factory/registry/token bindings. This completes the natural-expiry
control from its earlier finalized positive baseline; no local time advancement
or expiry-zero removal was used to establish C's negative result.

The #648 public approval-control exercise now has retained completion evidence;
issue closure remains subject to final evidence review. The local funded
journey for [#645 is already accepted](https://github.com/Ledova/ledova/issues/645#issuecomment-5827887653).
Physical Keystone acceptance and release-level public swap proof belong to
[#624](https://github.com/Ledova/ledova/issues/624), separately from this exercise.
Update these rows from retained observations; prepared verifiers, synthetic
setup, job success and elapsed time do not supply missing acceptance evidence.
