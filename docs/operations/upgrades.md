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
