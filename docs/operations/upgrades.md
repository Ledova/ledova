# Upgrading a test deployment

[Operations](README.md) · [Documentation](../README.md)

Apply only the migration notes relevant to the database you are upgrading. Schema reversibility does not guarantee data restoration.

- `companies/0003_delete_review_and_signature_models` (with
  `tokens/0013_remove_transferorder_signature_request` before it) drops
  `ApplicationReview`, `ReviewNote` and `SignatureRequest`. **Reversal does not restore data.** All three operations are `DeleteModel`,
  and reversing a `DeleteModel` recreates the table empty: rolling the migration
  back restores the schema and none of the rows. Export anything in
  `companies_applicationreview`, `companies_reviewnote` and
  `companies_signaturerequest` worth keeping before applying it.
- `portfolios/0004_delete_assetallocation`,
  `compliance/0005_remove_fiat_transaction_and_high_risk_country`,
  `wallets/0006_delete_fiattransaction_drop_unread_columns` (depends on
  `compliance/0005`) and `users/0017_delete_waitlist` drop the
  `asset_allocations`, `fiat_transactions` and `accounts_waitlist` tables and
  ten columns. Export any `accounts_waitlist` rows worth keeping first.
- `portfolios/0005_delete_portfoliosnapshot` drops `portfolio_snapshots`. The
  value series is computed on read in `portfolios/services/value_series.py`, and
  `GET /api/portfolios/{uuid}/snapshots/` keeps its path, parameters and row
  shape. The hourly `sync_all_wallets` job upserts one `DAILY` `HoldingSnapshot`
  per holding per day, so a wallet with no transactions still gets a point, and
  the series starts at a wallet's first holding snapshot rather than inventing
  anything before it. The nightly `sync_all_portfolios` periodic job no longer
  exists: delete any queued Procrastinate jobs under that name.
- `companies/0004_company_additional_info_response` stores the applicant's
  answer to a request for more information.
- `tokens/0035_trading_state_invariants` checks existing order/swap amounts,
  status/type values and the two challenge-consumption fields before installing
  constraints. Invalid data aborts the migration without changing any row; the
  error lists up to 20 UUIDs per violated rule. Resolve the identified history
  explicitly before retrying. Do not clamp fills, rewrite signed intent, reset
  consumed challenges or release unresolved swaps to make the migration pass.
  PostgreSQL then freezes each issued challenge's envelope and completed spend.
  Expired unspent challenges can still be purged. Existing unresolved swaps,
  including those without a transaction/hash, retain their state and quantities;
  neither timeout metadata nor nonce use alone resolves them. At this point the
  swap transaction UUID prevented competing preparation but did not provide signed
  transaction recovery after a process dies; `tokens/0057_swap_execution_guards`
  (#619) later added durable admission and exact-byte recovery, and finality
  consumption remains #7.
- `tokens/0039_swap_settlement_context` marks pre-existing swaps as legacy
  without changing their old fields, signatures or deadlines. It then requires
  a context on new inserts and refuses explicit legacy inserts, context changes
  and new-context identity replacement on PostgreSQL. Stop old API/worker writers and coordinate
  all consumers before permitting new matches; do not backfill historical
  domains, erase prior fields or bypass the cutover guard. Existing 24-hour
  signatures, the 15-minute new-match default, finite overrides and distinct
  equal orders retain their existing meaning. Changes to this protocol require composed PostgreSQL/scoped and chain validation.
- `blockchain/0007_transaction_outgoing_operation` and
  `tokens/0057_swap_execution_guards` (#619) bind a swap's transaction to its
  common outgoing operation and install the admission, intent-byte, identity and
  retained-outcome guards. The forward step refuses when an admitted execution
  already exists in the database, and reversal refuses once one does, so apply
  them before the #619 code runs with `BLOCKCHAIN_OPERATOR_KEY` configured — the
  first swap that collects both signatures under it admits an execution, whether
  or not a signer is admitted — and expect no way back once one exists. Existing
  unmarked swap transactions gain no signing authority and stay held for
  attribution. Financial completion no longer follows a receipt: parents and
  reservations stay held until #7's finality consumer, and market last price
  does not move until then.
- `tokens/0059_swap_approval_submission` (#6) creates the operator-only journal
  of participant-signed approval broadcasts and its trigger. It adopts nothing:
  approvals sent before it have no row and are never replayed, and a device
  that saved only a hash stays on today's behaviour. Stop old API processes
  before applying it, because an old binary still sends without recording.
  Afterwards `POST .../swap/approval-broadcast/` waits a few seconds rather
  than 120 for the receipt, so `swap_approval_unconfirmed` is answered more
  often and now means recorded: replayed by the five-minute
  `recover_swap_approval_submissions` sweep while the row is pending, and
  finished without effect once it is `reverted` or `superseded`, which its
  detail states. Reversal refuses while any
  submission row exists; the rows are broadcast capabilities and belong in
  protected backups.
- `tokens/0066_issuance_finality_and_boundary_history` (#647) records each
  issuance completion's finalized receipt and requires a register opening's
  captured boundary to carry its canonical transfer history, at capture and at
  application. It rewrites no existing row. Issuances completed before it have no
  recorded receipt and need operator attribution before any opening can represent
  them; a pending opening captured before it cannot be applied, so reject it and
  submit a fresh one; an opening applied before it holds every completion for
  attribution and cannot be recaptured. See
  [openings captured before the history was retained](register-foundation.md#openings-captured-before-the-history-was-retained).
  The database refuses an issuance completion without the receipt and a capture
  without the history, so an older binary still running fails closed on both.
  Reversal refuses once any finality evidence is recorded.
- `tokens/0068_completion_transaction_index` lets a settlement's or issuance's
  finalized receipt carry the transaction's index in its block. It rewrites no
  existing receipt. Completions finalized from then on record the index, and
  register recording uses it to follow chain order inside a block. Reversal
  refuses once any index is recorded.
- The issuer KYC switch has no migration. Until now `issuer_kyc_required` had no
  effect. With it on, a company whose owner is not identity-verified can no
  longer be submitted or resubmitted for review, or activated once approved. A
  company made active before the upgrade can still have a warning resolved or be
  reinstated. Check the setting before upgrading.
- The stored-register reads have no migration, but they change what an issuer
  sees. `GET /api/v1/tokens/{uuid}/holders/` and the register CSV serve the
  stored register and read no chain, so a share class with no applied opening
  reports `initialized: false` and its export returns 409
  `register_not_initialized` until an
  [opening is applied](register-foundation.md#approved-opening-capture-and-wallet-links).
  Rows become one per member with its `wallets` in place of `address`, each
  row's `enteredOn` becomes a date (`YYYY-MM-DD`) that is always present where
  it was a date-time or `null`, the response drops `listedTotal` and
  `discrepancy`, and the CSV gains a Member ID column and joins a member's
  wallets in Wallet addresses. Release the backend
  and the clients together: an older dashboard or mobile build reads `address`
  from each row and fails on the new ones. Update anything that parses the CSV
  by its old headers.
- `tokens/0069_opening_mapping_values` adds an insert check that every value in
  an opening proposal's mapping is a JSON string. It closes a gap in
  `tokens/0065`: an insert that bypassed `submit_opening` could record a `null`
  member, and applying that proposal then failed with a server error, so it
  could only be rejected. It rewrites and rechecks no existing proposal.
  Reversal drops the check.
- `tokens/0070_register_reconciliation` adds the retained reconciliation records,
  the staff acknowledgements of their discrepancies and the six-hourly
  `reconcile_every_register` task. Nothing is backfilled; the CSV summary says
  `never` until the first run. Reversal refuses once any reconciliation exists,
  and an acknowledgement cannot exist without one.
- `tokens/0071_register_export_audit` adds `RegisterExport` and replaces the
  single log line an export used to write. Earlier exports are not backfilled
  from logs. The daily `purge_former_members_past_the_clock` now also purges
  export records past the 2,557-day floor. Reversal refuses once any record
  exists.
- `tokens/0072_register_import` adds register imports, recorded member
  particulars and imported former members, with four owner routes under
  `/api/v1/tokens/register-imports/`, and a partial unique index that allows one
  applied import per share class. Nothing is backfilled. Recorded particulars
  name a member only where no live identity or resolved allotment stamp does.
  `FormerHolder.identity_source` gains `particulars`, which the fold records
  when a ceased wallet's member has only recorded particulars. The holders API's
  `formerMembers` now lists imported former members, whose `walletAddress` and
  `ceasedAtBlock` are `null`. Reversal refuses once any import exists.
- `tokens/0073_register_instructions` adds
  [register instructions](register-foundation.md#register-instructions-for-issues)
  for issues, with four owner routes under `/api/v1/tokens/register-instructions/`
  and a staff review in admin. Applying one is now the only way to approve a
  direct share issuance request; the admin **Approve** action for those requests
  is gone. It rewrites no existing row, and it adds a second guard to
  `tokens_shareissuancerequest` beside the `0048` one. The company's own database
  role can no longer approve, reject or start review of a request, insert one
  already decided, or change its reviewer, review time, notes or rejection
  reason. No role can approve one without an active staff reviewer. Allotment
  refuses a subscription that no applied instruction lists with its current
  terms. A request approved before `0073` keeps its approval and reviewer and can
  still execute, but once its class has an opening its issue waits until an
  instruction lists it, holding later effects in that class behind it; applying
  that instruction records it without approving it again, and entries already
  recorded stay as they are. Run the new code with the migration: an older binary
  still approves from admin and allots without cover, and the issues it approves
  then wait for an instruction. Reversal refuses once any instruction exists.
- `tokens/0074_register_inspection_copies` adds the `inspection_copy` kind of
  register export with its `digest`, `instruction`, `requested_on`, `recipient`
  and `late` columns, and two check constraints: an inspection copy carries all
  five and a register CSV export none. Existing records are CSV exports, which
  satisfy them unchanged; nothing is backfilled. It also adds the
  [Register outputs](register-foundation.md#preparing-an-inspection-copy) admin
  page, opened only by the new **Can change register outputs** permission: grant
  it to the staff who prepare inspection copies. Reversal refuses once any
  inspection copy exists.
- The issuer's waiting list and late-entry dating have no migration.
  `GET /api/v1/tokens/{uuid}/register/waiting/` lists, for the owner of a share
  class's company, each completed effect not yet recorded with the reason it
  waits; see [the waiting list](register-foundation.md#the-issuers-waiting-list).
  A register entry recorded after its effect waited is now dated the day it is
  made (UTC) rather than its completion date; one recorded as its effect
  completes still carries the completion date, and entries already recorded keep
  theirs. The register now refuses an issue or transfer dated before its latest
  entry, so where that entry carries a date after today, such as a correction
  dated in the future, later effects wait as `refused` until that date.
  Correction submission now refuses an effective date after the day it is
  submitted (UTC); a pending correction submitted before the upgrade is not
  rechecked, so reject one dated in the future rather than apply it.
- `tokens/0075_register_certificates` adds the `certificate` kind of register
  export and a check constraint: a certificate record carries a digest, an
  instruction and one or two pages, and no former rows, request date, recipient
  or late flag. It rewrites no existing record, which is a CSV export or an
  inspection copy. The [Register outputs](register-foundation.md#preparing-a-certificate)
  page gains **Prepare a certificate** under the existing **Can change register
  outputs** permission. Preparing one imports PyMuPDF, already a runtime
  dependency, in the web process that serves admin. Reversal refuses once any
  certificate record exists.
- `whitelist/0002_whitelistentry_treasury_addresses` makes
  `WhitelistEntry.wallet` nullable and adds `address` and `label` with a check
  constraint; `whitelist/0003` adds the partial unique constraint on `address`
  where `wallet` is null.
- `assets/0012_audy_base_deployment`, `tokens/0014_settlement_asset_columns`,
  `tokens/0015_fold_stablecoin_into_asset` and `tokens/0016_drop_stablecoin`
  fold `tokens.Stablecoin` into `assets.Asset`. Apply them in that order.
  `0014` also makes `SwapOrder.payment_token` nullable, which is what lets
  `0016` be unapplied on a database that holds swap orders; `0015` reverses by
  rebuilding a `Stablecoin` row for every asset it folded and every asset an
  order still points at, from that asset's deployment on
  `receiving_wallet_chain`, and re-pointing all three foreign keys, so
  `migrate tokens 0013_remove_transferorder_signature_request` returns the
  previous release's schema with the order history intact. `reserve_amount`,
  `reserve_updated_at` and the original `Stablecoin` uuids are not restored.
- The assets side of the fold is not undone at all. After a full rollback the
  database still holds every `assets.Asset` row `0015` created for a stablecoin
  that had no asset, every `assets.AssetChainDeployment` row it created on the
  settlement chain, and the contract address it wrote onto a deployment that
  already existed. `assets/0012` is separate and reverses on its own; nothing
  else on the assets side does. Drop those rows by hand if the rollback is
  meant to leave no trace, and remember they are what a re-applied `0015`
  matches against.
- `tokens/0015` refuses to run when a `Stablecoin` address disagrees with the
  address the matching asset already carries on the settlement chain. The
  migration is atomic, so the refusal writes nothing and names every
  conflicting pair: run `python manage.py migrate --noinput` against a restored
  copy of the database being upgraded to find out whether it fires, and reconcile the addresses
  before the real run. Overwriting the deployment silently would point mint,
  swap and transfer at a contract the stablecoin row does not name.
- `tokens/0015` also adds every folded asset, and `issued_stablecoin`, to
  `Operator.supported_settlement_assets`. Before the fold the settlement paths
  accepted any active `Stablecoin` with an address; after it they accept only
  what that many-to-many lists, so without the seeding
  `POST /api/v1/trading/transfer/prepare` would start refusing settlement
  assets and the wallet balance endpoint would stop listing them. Confirm the
  list in the operator admin after deploying. `0015` records the ids it
  actually added in a `tokens_stablecoin_fold_grant` table and its reverse
  removes only those, then drops the table, so an asset an operator had already
  configured by hand keeps its place through a rollback. A rollback run against
  a database folded by a build that predates that table logs a warning and
  leaves the many-to-many untouched.
- `assets/0012` moves the `AUDY` deployment from `ethereum` to `base` and gives
  it `STABLECOIN_CONTRACT_ADDRESS`. Any `AUDY` `Holding` keyed to the ethereum
  deployment stops resolving until the wallet sync runs again: count them
  before applying, and run `sync_all_wallets` (or wait one hour) after.
- `wallets/0013` renames `wallet_type` to `signing_preference` and preserves
  each recorded value; new unspecified wallets default to null. The API keeps
  `walletType` as a legacy alias, and supplying different values under both
  names is a validation error. Apply the migration and release its API before
  updating the clients: older clients keep using the alias against the updated
  backend, and the new clients require an API that serves `signingPreference`.
  The field is a self-declared hint, not custody assurance — see
  [Wallet ownership and signing](../architecture/wallets-and-valuations.md#wallet-ownership-and-signing).

## Before and after an upgrade

1. Use a reviewed commit with green CI. Keep the target on synthetic data and a
   supported local/public test network, with trading off.
2. Preserve database and private storage together. Rehearse applicable migrations
   on a restored copy, including any stated refusal conditions. Data-preserving
   rollback, schema reversal and irreversible deletion are different outcomes.
3. Configure [core settings and database roles](configuration.md), Redis, scanner,
   email and required providers. Redis is required even with trading disabled.
4. Stop stale API/worker writers where a protocol migration requires a coordinated
   cutover. Apply migrations, verify roles, run [seeds](operator-console.md#seeding),
   and restart workers with the new code.
5. Run `python manage.py reconcile_private_media --check` from `backend/` when
   private-storage history is relevant. See [file migration procedures](../reference/private-storage-migrations.md).
6. Inspect operator configuration health and [reconciliation](recovery.md). Confirm
   `/health/` returns 200 and anonymous `/api/operator/` returns 401; separately
   establish database, Redis, worker and provider readiness.

The notes above span historical migrations, not one current release. Newer journal,
wallet-identity and private-file constraints are documented beside their mechanisms:
[wallet identity](../architecture/wallets-and-valuations.md#network-identity),
[EVM journals](../reference/evm-transfers.md), [Bitcoin journals](../reference/bitcoin-transfers.md),
[chain observations](../reference/transaction-evidence.md), and [mint recovery](recovery.md#deployment-and-issuance).
