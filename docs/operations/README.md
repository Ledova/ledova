# Operations

[Documentation](../README.md)

Procedures for running a synthetic local or public-testnet Ledova instance: configure it, bring it
up, apply a release, rebuild its database, run its workers and recover unresolved work. It is for
operators and platform staff. Start with [getting started](../getting-started.md) for a new
checkout. Procedures assume the API, worker and database run compatible code.

Companies run their registers through appointments
([how a company decision works](../business/README.md#how-a-company-decision-works)); platform
staff work the queues that remain staff work. Do not grant company users platform-staff
permissions. Staff procedures that carry out a business workflow on a company's written instruction
are described with that workflow, linked in the table below.

| Task                                                                                         | Guide                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set environment variables, database roles and provider settings                              | [Configuration](configuration.md)                                                                                                                                                                                           |
| Deploy local or testnet contracts, align signer ownership, stand up a fresh environment      | [Chains and keys](chains.md)                                                                                                                                                                                                |
| Start workers, read the schedule, operate private storage, scanning and upload limits        | [Jobs and storage](jobs-and-storage.md)                                                                                                                                                                                     |
| Configure the operator record, read the console, seed reference data, work the review queues | [Operator console](operator-console.md)                                                                                                                                                                                     |
| Recover unresolved work and verify stored registers and publications                         | [Recovery](recovery.md)                                                                                                                                                                                                     |
| Publish to members on a company's written instruction                                        | [Publishing to members](../business/publications.md#publishing-on-the-companys-instruction)                                                                                                                                 |
| Prepare notice figures, work the due list or produce a company pack on written instruction   | [Notice figures](../business/member-records.md#preparing-notice-figures), [due list](../business/member-records.md#working-the-due-list), [company pack](../business/member-records.md#producing-the-broader-pack-in-admin) |
| Check a release on native builds and physical devices                                        | [Native probes](../engineering/mobile-releases.md#native-probes), [device checks](../engineering/mobile-releases.md#pre-release-device-checks)                                                                              |

## Bring up an instance

1. Use a clean, reviewed commit with its required CI checks passing.
2. Configure the PostgreSQL roles, Redis, origin and CSRF settings and the integrations the flow
   needs ([configuration](configuration.md)).
3. Apply the migrations, the role checks and the seed commands
   ([seeding reference data](operator-console.md#seeding-reference-data)).
4. Confirm `GET /health/` answers 200 and an anonymous `GET /api/operator/` answers 401. The health
   route is answered before database access and proves nothing about the database, Redis, workers
   or providers.
5. Open the [operator console](operator-console.md) and resolve its configuration
   warnings. Confirm a worker is running and scheduled work advances.
6. Confirm `trading_enabled` matches this deployment's intent: it is seeded on, and an operator can
   turn it off in the admin ([trading](../business/trading.md#what-trading-is-today)).

The [legal positions](../legal/positions.md) describe the unresolved assumptions to settle
before any real use.

## Apply a release

Follow [bring up an instance](#bring-up-an-instance) for the commit,
configuration, seeds and health checks, on synthetic data and a supported local or public test
network. A release adds:

1. Back up the database and [private storage](jobs-and-storage.md#private-storage) together, and
   rehearse the release's migrations on a restored copy before touching the instance.
2. Stop the API and worker writers where the release says a coordinated cutover is needed. From
   `backend/`, run `python manage.py migrate`, `python manage.py check_rls_roles` and
   `python manage.py check_rls_catalogue`, run the
   [seed commands](operator-console.md#seeding-reference-data), then restart the
   workers on the new code.
3. Confirm `GET /health/` answers and read [recovery](recovery.md) for unresolved
   work.

A release whose initial migrations differ from the instance's needs a
[rebuild](#rebuild-a-database): there is no in-place adoption command.
Operator steps a release needs are recorded in its pull request. Journal, wallet-identity and chain
constraints are documented beside their mechanisms:
[wallet identity](../engineering/chain.md#network-identity),
[EVM journals](../engineering/wallet-protocols.md#evm-transfers),
[Bitcoin journals](../engineering/wallet-protocols.md#bitcoin-transfers),
[chain observations](../engineering/wallet-protocols.md#wallet-chain-observations) and
[mint recovery](recovery.md#deployment-and-issuance).

## Rebuild a database

Project migrations start fresh
([decision](../decisions.md#minimum-tests-and-fresh-migrations)): a new database gets the
current models and PostgreSQL guards, and an older database cannot adopt that history in place.
Before changing a running instance, agree with the owner what is worth keeping and the recovery
checkpoint; live deployment, live migrations, signer activation and real-funds use need the owner's
explicit direction ([CONTRIBUTING](../../CONTRIBUTING.md#review-and-merge)). The
[ledova.io rebuild of 11 October 2026](evidence/ledova-io-rebuild-2026-10-11.md)
is the completed example.

1. Back up the database and all private storage, including retained files without rows, with
   matching release and configuration provenance and restricted file permissions. Record the
   snapshot and copy checkpoints and any consistency gaps. Preserve the originals and the backup,
   and keep credentials and raw records private.
2. Take a read-only inventory with the owner: aggregate counts, sizes, storage and reference
   coverage, and what is worth keeping (actual accounts, companies, appointments, members, register
   and holding records, documents and evidence). Plan identity and fingerprint preservation; record
   selection and mappings wait for the owner's decision on the actual inventory.
3. Validate the backup and rehearse the proposed mappings on a private, isolated copy with workers,
   signers and external integrations disabled. At the approved cutover, stop writers, export only
   the agreed records and rebuild an empty PostgreSQL database with the fresh migrations, roles,
   grants, RLS, triggers and functions. Seed only reference data and import the agreed records;
   invent no approved actors, receipts or ownership, and import no old recorder.
   [Checking stored MIME types](jobs-and-storage.md#checking-stored-mime-types)
   applies to exported files.
4. Verify the system, role and catalogue checks, the API schema check, the small core suite,
   register totals and private-file references. Record the results and the recovery route through
   the original database, storage backup and matching release and configuration, and obtain release
   approval before serving the rebuilt instance.

Downtime depends on the data: the actual inventory and sizes, owner-confirmed mappings and a
measured, safe isolated rehearsal are needed before a firm estimate. Reversible isolated validation
needs no routine extra approval. Rollback restores the matching old release, database, private
storage and configuration while writers remain stopped. Writes accepted after cutover would need
separate recovery; the backup does not preserve them automatically.

## Evidence

Dated records of what an instance or a check actually did. They are historical evidence, not
descriptions of current behaviour.

| Record                                                                                     | What it records                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [ledova.io rebuild, 30 October 2026](evidence/ledova-io-rebuild-2026-10-30.md)             | The fresh-database rebuild that kept no earlier records, and its rolled-back first switch      |
| [ledova.io rebuild, 11 October 2026](evidence/ledova-io-rebuild-2026-10-11.md)             | The completed fresh-database rebuild and release of the private test deployment                |
| [Essential journey, 11 October 2026](evidence/essential-register-2026-10-11.md)            | The fresh-schema company and member observation and its substitutions                          |
| [Demonstration journey, September 2026](evidence/demonstration-journey-2026-09.md)         | The original synthetic chain journey                                                           |
| [Approval controls](approval-controls.md)                                                  | The company-scoped approval controls, the bypass review and the fresh-start redeploy rehearsal |
| [Base Sepolia observations, 25 September 2026](evidence/base-sepolia-2026-09-25/README.md) | Checksummed public-chain snapshots behind the approval-control evidence                        |

Next: [configuration](configuration.md),
[chains and keys](chains.md) or [recovery](recovery.md).
