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
| Apply checks at relevant stages, including listing, acceptance and transfer | Order creation and swap signing check the account's live classification for the class's company; `ShareToken._update` checks the registry on every movement | [#702](https://github.com/Ledova/ledova/pull/702), [#701](https://github.com/Ledova/ledova/pull/701) | `tokens.tests.test_marketplace_stage_checks.ListingRequiresALiveClassificationTest.test_a_revoked_classification_records_the_eligibility_refusal`; `...AcceptanceRequiresALiveClassificationTest.test_a_party_whose_classification_was_revoked_cannot_accept`; `ShareToken` → `Sender checks` → "Should refuse a direct transfer from a removed sender" |
| Bind approvals to the correct participant, company, wallet and action; enforce expiry, revocation and protection against reuse | The factory keys one registry per ACN; a change carries its company, address, action and expiry, bound into the exact `setExpiry` calldata by a database trigger; `isWhitelisted` is `expiresAt > block.timestamp` | [#701](https://github.com/Ledova/ledova/pull/701) | `ShareTokenFactory` → `Cross-company isolation` → "Should grant nothing on company B's token for an approval in company A's registry"; `WhitelistRegistry` → "Should stop listing an address once its expiry has passed"; `whitelist.tests.test_change_recovery.WhitelistChangeRecoveryTest.test_each_company_keeps_its_own_approval_row_and_registry`; `whitelist.tests.test_change_migration.WhitelistChangeMigrationTest.test_the_guard_binds_the_expiry_into_the_registry_call`; `whitelist.tests.test_entry_scoping.WhitelistEntryScopingTest.test_operator_pending_retry_preserves_identity_and_refuses_opposite_command` |
| Enforce rules on direct contract calls and delegated transfers; check administrative and recovery paths for bypasses | `_update` is the single enforcement point, so a direct call, a delegated transfer and a swap settlement all meet it; the backend's four write authorities each check their own actor | [#701](https://github.com/Ledova/ledova/pull/701), this slice | `ShareToken` → `Sender checks` (four cases); `Approval bypasses` (whole file); `whitelist.tests.test_bypass_paths` (whole file) — see [the bypass review](#the-bypass-review) |
| Refresh affected permissions when evidence or restrictions change, with documented update delays | Revocation, renewal, suspension and wallet deletion each enqueue a refresh under the staff member whose review decided it; a sweep every five minutes is the safety net, and the promise is fifteen minutes | [#702](https://github.com/Ledova/ledova/pull/702) | `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_a_revoked_claim_removes_the_approval_and_a_second_refresh_submits_nothing`; `...test_the_sweep_submits_under_the_staff_member_whose_review_decided_it`; `...test_revoking_a_claim_enqueues_the_refresh_for_the_reviewer` |
| Hold affected actions when required checks are stale, unavailable or unresolved, with review and recovery procedures | A screening result without a valid risk score leaves the screening pending rather than approving it; a failed removal reads as not approved and is resubmitted; an unreadable registry reads `unknown`, never `whitelisted`; an unresolved change blocks the opposite command until recovery finishes | [#700](https://github.com/Ledova/ledova/pull/700), [#701](https://github.com/Ledova/ledova/pull/701), [#702](https://github.com/Ledova/ledova/pull/702) | `compliance.tests.test_crypto_screening_results.ProviderWithoutScreeningTest.test_a_provider_that_cannot_screen_fails_and_raises_the_monitoring_flag`; `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_a_failed_removal_reads_as_not_approved_and_is_resubmitted`; `whitelist.tests.test_status_view.WhitelistInvestorStatusServiceTest.test_a_chain_error_is_reported_as_unknown_rather_than_a_refusal` |
| Resolve mistaken identity matches and expired restrictions through an accountable correction process | Every change names one of four authorities and the person who submitted it; neither is editable afterwards, and the database refuses an authority outside the four; a refresh is attributed to the reviewing staff member, and a change no actor explains is listed for staff rather than written | [#701](https://github.com/Ledova/ledova/pull/701), [#702](https://github.com/Ledova/ledova/pull/702), this slice | `whitelist.tests.test_change_scoped.ScopedWhitelistChangeTest.test_admin_confirmation_preserves_identity_across_repeated_posts`; `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_the_sweep_lists_a_row_no_actor_explains_rather_than_writing_it`; `whitelist.tests.test_bypass_paths.WhitelistAuthorityBypassTest.test_the_database_refuses_moving_an_admitted_change_to_another_authority` |

§5 also asks that screening providers be replaceable while effective
restrictions are preserved. Only the KYCAID adapter implements crypto
screening; the base adapter raises. [#700](https://github.com/Ledova/ledova/pull/700)
made a provider that cannot screen fail the screening and raise the monitoring
flag rather than approve it, which is what replaceability has to preserve:
`compliance.tests.test_crypto_screening_results.ProviderWithoutScreeningTest.test_a_provider_that_cannot_screen_fails_and_raises_the_monitoring_flag`.

## What these controls do not do

- **The acceptance check follows the caller, not the signature.**
  `submit_signature` checks the classification of the account making the
  request. The signature's own party is derived from the address it recovers
  to, and the two are not bound together, so a buyer can carry a seller's
  signature past the platform check. The chain still refuses the settlement
  once the seller's approval is removed; between revocation and removal the
  chain does not.
- **A removal is not instant.** The platform refuses at once and the chain
  follows within fifteen minutes. A direct contract call can move shares in
  that window, and pausing the token is the incident lever.
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
| The refresh sweep resolves every approval | `{'checked': 1, 'submitted': 0, 'unattributed': 1, 'errors': 0}`, with the unattributed row logged | Not mutated; the unattributed case is proved by `whitelist.tests.test_classification_refresh.ClassificationRefreshTest.test_the_sweep_lists_a_row_no_actor_explains_rather_than_writing_it` |
| No class has a deployment whose factory differs | `[]` | Not mutated |

Steps 6 and 7 are performed against a real node, with an admitted test signer,
by the real-chain suite: `make chain-test` deploys a class through
`tokens.services.deployment` and writes approvals through
`whitelist.services.changes`, and
`tokens.tests.test_chain_integration.WhitelistChangeChainTest` and
`ShareTokenChainTest` assert the registry binding and the expiry the chain
enforces. That is the evidence for those two steps until signer admission is
opened.

### Base Sepolia

The owner has authorised exactly one Base Sepolia deployment of these
contracts, to be run once a funded deployer key is in place. It has not been
run. When it is, record here: the deployer address, the three contract
addresses, the block each was created in, and the result of each step-8 check
against that deployment.

| Field | Value |
| --- | --- |
| Run on | *not yet run* |
| Deployer | *not yet run* |
| `ShareTokenFactory` | *not yet run* |
| `AtomicSwap` | *not yet run* |
| `AUDY` | *not yet run* |
| Step-8 checks | *not yet run* |
