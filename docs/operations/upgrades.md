# Rebuilding and upgrading a test deployment

[Operations](README.md) · [Documentation](../README.md)

The [11 October decision](../decisions.md#minimum-tests-and-fresh-migrations)
starts project migrations fresh. New databases use the current models and
PostgreSQL guards; an older database cannot adopt that history in place.

## Fresh database rebuild

The [11 October follow-up](../decisions.md#binding-caps-and-backup-authorisation)
already authorises a ledova.io backup and read-only database/private-storage
inventory and reversible isolated validation. This page records no completed
live work. Live selective-record export, stopping writers, rebuild, migration,
re-seeding, configuration and release still need the owner's go-ahead.

1. Back up the database and all private storage, including retained files
   without rows, with matching release/configuration provenance and restricted
   file permissions. Record
   snapshot/copy checkpoints and any consistency gaps. Preserve the originals
   and backup; keep credentials and raw records private.
2. Read-only inventory records aggregate counts, sizes, storage/reference coverage and
   what is worth keeping with the owner: actual accounts, companies, appointments,
   members, register/holding records and documents/evidence. Plan identity and
   fingerprint preservation; record selection and mappings await the owner's
   decision on the actual inventory.
3. Validate the backup and rehearse proposed mappings on a private isolated copy,
   with workers, signers and external integrations disabled. At the approved
   live cutover, stop writers, selectively export only agreed records and rebuild
   an empty PostgreSQL database using fresh migrations, roles, grants, RLS,
   triggers and functions. Seed only reference data and import agreed records;
   invent no approved actors, receipts or ownership, and import no old recorder.
4. Verify system, roles/catalogue and API snapshot checks, the small core suite,
   register totals and private-file references. Record results and recovery via
   the original database/storage backup and matching release/configuration;
   obtain release approval before serving
   the rebuilt instance.

Downtime is data-dependent: actual inventory/sizes, owner-confirmed mappings and
a measured safe isolated rehearsal are needed before a firm estimate. Reversible
isolated validation needs no routine extra approval. Rollback restores the matching old release,
database, private storage and configuration while writers remain stopped.
Writes accepted after cutover would need separate recovery; the backup does not
promise to preserve them automatically.

Held product migrations rebase onto this fresh history. This is no authorization
for deployment, signer activation or real-funds use.

## Applying a release

Follow the [pre-flight list](README.md#before-using-a-configured-instance) for
the commit, configuration, seeds and health checks, on synthetic data and a
supported local or public test network. A release adds:

1. Back up the database and private storage together, and rehearse the
   release's migrations on a restored copy before touching the instance.
2. Stop API and worker writers where the release says a coordinated cutover is
   needed. From `backend/`, run `python manage.py migrate`,
   `python manage.py check_rls_roles` and `python manage.py check_rls_catalogue`,
   run the [seed commands](operator-console.md#seeding), then restart the
   workers on the new code.
3. Confirm `GET /health/` answers and read [recovery](recovery.md) for
   unresolved work; the health route proves nothing about the database, Redis,
   workers or providers.

Operator steps a release needs are recorded in its pull request; a dated note is
added here only when a running instance must act. Journal, wallet-identity and
chain constraints are documented beside their mechanisms:
[wallet identity](../architecture/wallets-and-valuations.md#network-identity),
[EVM journals](../reference/wallet-transfers.md#evm), [Bitcoin journals](../reference/wallet-transfers.md#bitcoin),
[chain observations](../reference/transaction-evidence.md) and [mint recovery](recovery.md#deployment-and-issuance).
