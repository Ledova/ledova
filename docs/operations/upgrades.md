# Upgrading a test deployment

[Operations](README.md) · [Documentation](../README.md)

Apply only the migration notes relevant to the database you are upgrading. Schema reversibility does not guarantee data restoration.

## One registry product

`operators/0002_remove_operator_deployment_mode` removes only the legacy
`deployment_mode` column. The initial migration remains unchanged. Operator
identity, payment and eligibility configuration, settlement-asset membership,
companies, registers, payment records, private files, extraction history and
read audits are preserved. Supporting evidence uses the same private-access
and retention controls on every instance; there is no replacement mode flag.
The migration depends on `tokens/0015_fold_stablecoin_into_asset`, the last
historical migration reading the operator's old model. Rolling back that fold
therefore restores the mode column first; no historical migration is rewritten.

Coordinate the API, workers and client release. Retire clients that require
`deploymentMode` before serving the new response, then stop old API/worker
processes before applying the migration and restarting with the new code. The
new clients do not query the operator to decide whether evidence is available.
The generated OpenAPI snapshot and shared types no longer contain the field or
its enum. This retirement requires no contract deployment or signer activation.

Rehearse against a restored database with its private storage. From `backend/`,
the ordinary suite includes `operators.tests.test_product_mode_migration`,
which upgrades historical models from both old mode values and verifies
configuration, evidence bytes, extraction/read history, payment records and
register entries before and after reversal. Run the required
[ordinary/scoped suites and role/catalogue checks](../development/testing.md#commands)
before release.

Reversal recreates the column with the historical `registry` default for every
row. It cannot reconstruct a removed `single_issuer` choice. Restore a backup
to recover that choice; coordinate old code and clients with schema reversal.

## Representative authority requests

`companies/0012_company_authority_request` adds an immutable private-evidence
request table, requester-only RLS and a guarded creation boundary. Existing
companies, owners, reviews, register entries and pending instructions are
preserved. It seeds no appointments and changes no approval or activation.
The [client workflow](../plans/company-managed-registers/authority-requests.md)
retains pending requests and withdrawal history. Initial self-declaration
admission and self-revocation are added separately by `companies/0015`.

The migration requires the existing role-creation migration and grants only its
new table; it does not pull the later catalogue grant ahead of the queue schema
on a fresh database. Rehearse both an existing database upgrade and a full fresh
migration with the required ordinary/scoped and role/catalogue checks.

Reversal succeeds only with an empty request table. Once requests exist it
refuses, preserving request history and its referenced private files. Back up
database and private storage together; do not delete requests to force a downgrade.

`companies/0013_company_authority_request_withdrawal` adds immutable withdrawal
history without changing the existing requests, snapshots or file references.
Its requester-only policy and guarded insert restore each connection's prior
principal. Empty reversal preserves the original requests; populated reversal
refuses to discard cancellation history. Back up database and private storage
together before upgrading or reversing either migration.

`companies/0014_authority_request_capabilities_refuse_null` makes the request
guard refuse JSON `null` in requested or delegatable capabilities, which it
previously accepted. It replaces only that check in the installed guard, and
neither direction filters or rewrites retained requests. Reversal restores the
earlier check, so a downgraded database accepts `null` elements again. Only a raw
insert on the operator connection can supply one: the service refuses
capabilities that are not listed strings.

`users/0031_protected_identity_results` protects the existing server-owned
identity provider identifiers/results and configured issuer identity requirement
from app-connection changes. Provider services record their existing results
through bounded operator transactions; ordinary profile changes remain available.
Deploy the backend that ships this migration before or together with applying
it: earlier binaries save provider identifiers and results on the app connection,
which the installed trigger refuses. Reversal removes these write guards without
changing retained identity data.

`companies/0015_self_declared_company_appointments` adds private initial
appointments, exact declaration capture, retained ABR check references and
immutable self-revocation. It also adds the authority-purpose ABR check and
prevents withdrawal after admission. It seeds no owners, activates no company
and approves no pending instruction. Empty reversal preserves pending/withdrawn
requests and their files; populated reversal refuses to discard appointments,
declarations or revocations. Do not delete authority history to force reversal.

`companies/0016_appointee_keyed_appointments` keys company appointments on the
appointee. It adds non-null `appointee` and `appointee_profile` columns backfilled
from each appointment's bootstrap request inside the migration transaction, the
only moment the appointment immutability trigger is disabled; the trigger is
re-enabled before the transaction commits and afterwards also refuses an appointee
other than the request's requester. `company` becomes a plain foreign key with a
partial unique index that keeps the self-declaration bootstrap at one per company,
and the appointment read policy is reinstalled on `appointee_id`, which admits the
same rows. A fresh install leaves the appointment table denied to the app role
between `0015` and this migration, because its term names the new column. It
creates no table, adds no endpoint and seeds no appointment. Reversal restores
the request-keyed policy and the earlier trigger body before dropping the
columns, and refuses when any appointment's appointee differs from its request's
requester, which no delivered path can produce.

`companies/0017_company_team_invitations` adds immutable company invitations and
their private inviter history. An appointment now has exactly one initial request
or invitation source; invitation acceptance names the actual accepting account
and profile without inventing ABR evidence. The initial-root unique index remains
permanent after expiry or revocation. New guards bind invitation issuance to the
selected current delegation envelope, acceptance to the code proof and exact
terms, and non-self revocation to current company administration. The app role
cannot insert or change these records. Bounded team reads expose permitted
account/scope fields rather than private authority or identity evidence.

This migration also aligns initial admission with company-first locking and
checks expiry against actual time after lock waits. It seeds no owner, changes
no register decision and approves no pending instruction. Backend and generated
API types provide the new invitation/team operations; the existing initial
request clients remain compatible. Both clients now provide the team workflow.
Any retained invitation, including an unaccepted one, or non-self administrator
revocation prevents reversal. Supported empty or initial/self-revocation
reversal restores the preceding guard bodies and policies exactly. Do not purge
history to force a rollback. Apply only through the separately authorised upgrade
process with the database and private storage preserved together.

`companies/0019_legacy_owner_appointments` records retained legacy sources and
administrator appointments for existing companies without an initial-request or
legacy-owner root. It skips existing roots even when expired or revoked, and
preserves requests, evidence, owners, reviews, pending instructions and historical
actors. Each source binds the actual company, owner account and owner profile at
upgrade time. A missing owner profile refuses the atomic upgrade before seeding;
repair the actual retained profile through its supported workflow before retrying.
The upgrade records its own provenance and time, with no invented declaration,
provider result, director authority, activation or instruction approval.

Legacy owners receive personal `admin` and onward delegation of the six existing
capabilities; current account, email and configured identity checks still apply.
The source table has forced RLS denying app reads/writes, and database guards
refuse source changes or new legacy records after the upgrade. New companies and
later owner changes are not seeded. Revocation never reopens initial admission.

Coordinate this atomic migration with company and authority writers: it locks
existing companies before owner accounts, profiles and appointment schema changes.
The backend schema, generated types and both clients must ship together because
appointment history adds `legacy_owner` and its declaration fields are null;
initial/invited records keep their exact declarations. Rehearse the historical
upgrade and a fresh migration with ordinary/scoped tests, roles/catalogue and
migration drift checks. Back up the database and private storage together.
Reversal refuses while any legacy source or appointment remains, including a
revoked appointment or retained source alone. Supported empty reversal restores
the preceding guard and constraints. Do not delete history to force a downgrade.

## Remaining company-managed register upgrade

The accepted [company-managed register plan](../architecture/company-managed-registers.md)
has delivered product-mode retirement and initial self-declared appointments
above, plus the invitation/team API, both client team screens and the legacy-owner
upgrade. Dependent company-authority workflows remain planned. The historical migrations
below remain applied history; do not edit them or reset a database to implement
the new direction.

- Replace global staff gates with company appointments and scoped service,
  row-level-security and database admission checks. An existing company owner
  may seed a company administrator, but must not thereby acquire a director
  mandate or approve a pending instruction. Preserve the genuine historical
  actors on completed reviews and operations.
- Back up the database and referenced private files together, verify the
  migration on preserved data and retain exact unresolved signed operations
  for recovery. Deployment-mode retirement does not require fresh contracts,
  signer admission or the [#648 fresh-start redeploy](chains.md#fresh-start-redeploy).

- `tokens/0092_company_register_wallet_links` and
  `tokens/0093_company_register_wallet_link_guards` make member-wallet links
  company-run (#864), as `0088` and `0089` did for openings. `0092` adds
  append-only link decisions, operator-only, adds the preparing appointment and
  the `authority` upload to links, makes the staff-era document UUID nullable
  with a check constraint pinning the two shapes, and closes owners' direct link
  inserts. `0093` replaces, by exact single replacements, the link guard `0067`
  installed: a link is inserted only by a company-run preparation from the
  preparer's own `authority` upload, and an outcome must match a decision by the
  same person at the same time. The new decision guards bind the person, the
  company command and a current appointment, and the decision carries a digest
  the database recomputes, binding, for application, the current links of the
  mapped addresses. Nothing is backfilled. Links still waiting for the retired
  staff review stay readable and can only be rejected by the company; the admin
  keeps links as read-only history, the review page is gone, and the synthetic
  staff seed no longer grants the link change permission. This release adds the
  decision routes and `GET /api/v1/tokens/register-links/waiting-wallets/`, and
  no client. An integration that submitted links now prepares them, naming its
  `appointment` and an `authority_evidence` upload where it named a company
  `document_id`. Reversing `0093` refuses once any company-run link or link
  decision exists, which covers the `authority` uploads those links use; `0086`'s
  reversal still refuses while any other `authority` upload exists. Otherwise it
  restores the guard exactly as `0067` installed it, and reversing `0092` then
  restores owners' direct submissions.
- `tokens/0090_company_particulars_changes` and
  `tokens/0091_company_particulars_change_guards` let a company change a
  member's particulars (#864). `0090` adds company-run particulars changes,
  readable by the company's register readers and written only by the bounded
  register command, and their append-only decisions, operator-only, and adds the
  `supporting` upload kind. It gives each member's particulars the date they hold
  (`as_at`), backfilled from the import that recorded them, and a nullable
  source change, with a check that a row names exactly one source, an import or
  a change. `0091` admits `supporting` uploads to the evidence guard and installs
  the change, decision and deferred effect guards, which bind the person, the
  company command, a current appointment and a digest the database recomputes.
  It also guards writes to particulars, which had none beyond row-level
  security: particulars come only from the application of the import or change
  they name, by the person applying it through the company command, with exactly
  the values it carries; they never move to another member or an earlier date;
  no company command removes them; outside one, the retention purge removes
  them, and the database does not tell it apart from other operator code; and
  the app role writes none.
  The import guard's application check now also counts particulars a change
  recorded with a later date. Nothing else is backfilled. This release adds the
  `/api/v1/tokens/register-particulars-changes/` routes and no client screen;
  the shared API types and the mobile upload labels know the new upload kind,
  so deploy the backend before or with the clients. Reversing `0091` refuses
  once any change, decision or `supporting` upload exists; otherwise it restores
  the import and evidence guards exactly as `0084` and `0086` left them.
  Reversing `0090` then drops the new tables and columns.
- #864's opening screens need no migration. They read
  `GET /api/v1/tokens/{uuid}/register/opening-holders/`, added with them, which
  reads the chain and stores nothing, and each opening's boundary summary now
  names its mapped members. Both also say with `memberExists` whether each
  mapped member already exists, and a preparation whose mapping no longer
  matches the boundary's holders is refused with the code
  `opening_holdings_moved`. Deploy the backend before or with the clients and
  roll them back together. Older clients keep working against the new backend.
- `tokens/0088_company_register_openings` and
  `tokens/0089_company_register_opening_guards` make register openings
  company-run (#864), as `0085` and `0086` did for corrections. `0088` adds
  append-only opening decisions, operator-only, adds the preparing appointment
  and the `authority` upload to openings, makes the staff-era document UUID
  nullable with a check constraint pinning the two shapes, and closes owners'
  direct opening inserts. `0089` replaces, by exact single replacements, the
  opening guard `0065` installed and the boundary-history guard from `0066`. An
  opening is inserted only by a company-run preparation, with its boundary present,
  well formed, carrying its canonical transfer history and pairing exactly with the
  mapping; a boundary can no longer be added afterwards; and an outcome must match
  a decision by the same person at the same time. The new decision guards bind the
  person, the company command and a current appointment, and the decision carries
  a digest the database recomputes, binding the boundary block and, for
  application, the class's register state. Nothing is backfilled. Openings still
  waiting for the retired staff review, whether or not a reviewer captured their
  boundary, stay readable and can only be rejected by the company; the admin keeps
  openings as read-only history and the review page is gone. This release adds no
  client. An integration that submitted openings now prepares them, naming its
  `appointment` and an `authority_evidence` upload where it named a company
  `document_id`; preparation captures the boundary, so the opening reads the chain
  then rather than at a staff review. Reversing `0089` refuses once any company-run
  opening or opening decision exists, which covers the `authority` uploads those
  openings use; `0086`'s reversal still refuses while any other `authority` upload
  exists. Otherwise it restores both guards exactly as `0065` and `0066` installed
  them, and reversing `0088` then restores owners' direct submissions.
- #864's register history, correction and acknowledgement screens need no
  migration. They read `GET /api/v1/tokens/{uuid}/register/entries/`, filter
  corrections by share class with `token` and look entries up by `entry`, all
  added with them, so deploy the backend before or with the clients and roll
  them back together. Older clients keep working against the new backend.
- `tokens/0087_company_discrepancy_acknowledgements` makes reconciliation
  discrepancy acknowledgement a company step (#864). It adds the acknowledging
  appointment and a retry key to acknowledgements, with a check that a row has
  both or neither and one acknowledgement per person and key, and replaces the
  acknowledgement guard `0070` installed: an acknowledgement must come through
  the company command, by the person it names, from that person's current
  appointment holding `admin` or `approve`, for a row of the class's latest
  reconciliation. The staff requirement and the `register_acknowledge` command
  are gone. Nothing is backfilled: staff-era acknowledgements keep both new
  fields empty, still explain their rows and read as provided by staff. The
  release adds the `/api/v1/tokens/register-reconciliations/` routes and no
  client. Reversing `0087` refuses once any company acknowledgement exists;
  otherwise it restores the staff guard exactly as `0070` installed it.
- `tokens/0085_company_register_corrections` and
  `tokens/0086_company_register_correction_guards` make register corrections
  company-run (#864), as `0083` and `0084` did for imports. `0085` adds
  append-only correction decisions, operator-only, adds the preparing appointment
  and the `authority` upload to corrections, makes the staff-era document UUID
  nullable with a check constraint pinning the two shapes, and closes owners'
  direct correction inserts. `0086` admits `authority` uploads to the evidence
  guard and installs the decision guards: decisions bind the person, the company
  command and a current appointment and carry a digest the database recomputes,
  and the correction guard admits only company-run preparation and outcomes that
  match a decision. Nothing is backfilled. Corrections still waiting for the
  retired staff review stay readable and can only be rejected by the company; the
  admin keeps corrections as read-only history and the review page is gone. This
  release adds no client, and the decision kind enum is renamed
  `RegisterDecisionKindEnum` in the API schema. An integration that submitted
  corrections now prepares them, naming its `appointment` and an
  `authority_evidence` upload where it named a company `document_id`. Reversing
  `0086` refuses once any `authority` upload, correction decision or company-run
  correction exists; reversing `0085` then restores owners' direct submissions.
- `tokens/0083_company_register_imports` and
  `tokens/0084_company_register_import_guards` make register imports company-run
  (#864). `0083` adds company-provided evidence uploads and append-only import
  decisions, both operator-only, adds the preparing appointment, both uploads,
  the ASIC extract copy and its snapshot to imports, and closes owners' direct
  import inserts. `0084` installs the guards: uploads and decisions bind the
  person, the company command and a current appointment, decisions carry a
  digest the database recomputes, and the import guard admits only company-run
  preparation and outcomes that match a decision. Nothing is backfilled. Imports
  still waiting for the retired staff review stay readable and can only be
  rejected by the company; the admin keeps imports as read-only history and the
  review page is gone. This release adds no client. Reversing `0084` refuses
  once any upload, decision or company-run import exists; reversing `0083` then
  restores owners' direct submissions.
- #864's register reads by appointment need no migration. Deploy the backend
  before or with the clients: the new web and mobile Register read
  `GET /api/v1/tokens/register/`, which an older backend does not serve, while
  older clients keep working against the new backend. Roll the clients back with
  the backend. A backend rolled back alone breaks the new Register pages for every
  reader, owners included, because those pages list their classes only through
  that route; the older backend serves register reads to owners alone, through
  the share-class routes.

### Company-authorised empty deployments

`tokens/0098_company_register_deployments` adds company deployment proposals and
append-only decisions, plus a nullable source association on `TokenDeployment`.
Private captured wallet/account/profile/user associations remain on operator-only
records; bounded company services expose the review snapshot. Historical journals,
nullable principals, signatures and transactions retain their original identities.
No company source, approval or actor is backfilled.

`tokens/0099_company_register_deployment_guards` binds preparation, decisions,
original admission and every fresh signature to the exact company source. It also
fences register-head advances while original deployment projection is pending,
binds a genuinely new opening to its approved original chain boundary, and refuses
fresh issuance execution over an import-origin register. Signed original recovery
retains its existing receipt/finality protections. Default-deferred authority
checks use actual time; as with the existing company decision guards, a trusted
caller that forces constraints early controls that deferred-check boundary.

Deploy the backend, workers and clients together. Both clients replace direct
owner deployment with `/api/v1/tokens/register-deployments/`; an older backend
cannot serve that family, and an older client's retired deploy route is refused
by the new backend. The company's Register links to the bounded class detail;
metadata access does not grant old private issuer-history or unconverted
issue/capital/pause permissions. Empty deployment issues no shares and does not
mirror a populated register. See the
[company workflow and recovery limits](../plans/company-managed-registers/company-deployments.md).

Reversal of `0099` refuses while any company deployment proposal, decision or
nonnull execution source exists, including rejected and merely submitted work.
An empty reversal restores the prior guards before `0098` removes its empty new
tables and nullable association. Preserve database and private storage together;
do not delete company history to force a downgrade. Historical NULL-source
deployment/signature recovery remains separate from fresh signing authority.

### Company non-paid chain grants

The third #867 increment is in progress; its
[workflow guide](../plans/company-managed-registers/company-register-issues.md)
and eventual pull request distinguish implemented source from completed release
verification. `tokens/0100_company_register_issue_instructions` extends the
existing ISSUE instruction with company preparation, append-only decisions,
member/nomination/wallet approval and retained evidence. It adds a nullable
original source to the existing issuance execution journal. Historical requests,
instructions, actors, transactions and signed bytes receive no invented company
source or paid subscription.

`tokens/0101_company_register_issue_guards` binds current preparation,
approval/application/rejection and fresh signing to that exact source. Prepared
requests are frozen under `UNDER_REVIEW`; application reserves and admits once.
Finalised outcome and register recording remain distinct, with original
executed-but-unentered recovery and reservations. Genuine paid admission and
retained ISSUE/TRANSFER instructions keep their applicable guards and attribution;
import-origin registers still cannot acquire fresh chain issue authority.

Deploy the backend, workers and both clients together. The new clients use
`/api/v1/tokens/register-issues/` and the existing LINK family for an exact nominated
wallet before a first mint. An older backend cannot serve this family; an older
client's direct owner issue POST is retired by the new backend. Paid issuance,
capital and pause have their own coordinated upgrades below.

Reversal of `0101` refuses retained company preparations, decisions or nonnull
execution sources, including rejected or merely prepared work. Empty reversal
restores the preceding instruction/request/execution guards before `0100`
removes its empty new records and nullable associations. Preserve database and
private storage together, including original signed and paid history. Final
fresh migration/role/catalogue, reversal and recovery evidence belongs in the
increment's pull request; these release notes authorise no live migration.

### Company paid issues

The sixth #867 increment is under implementation; its
[paid-issue guide](../plans/company-managed-registers/company-paid-issues.md)
distinguishes its source contract from completed release verification.
`tokens/0106_company_register_paid_issues` adds nullable immutable PROTECT
subscription provenance to the existing register instruction. Historical
instructions, requests, payments, execution journals and actors receive no
invented company source or approval.

`tokens/0107_company_register_paid_issue_guards` extends the actual paid/request
and company-source guards. It binds exact company preparation, consumed approval,
late application, original subscription/request/execution pairing and fresh
signing while preserving original financial cancellation, finality and retained
register outcomes. Preparation and approval create no request, paid link, journal
or issuance job. Existing original paid request bindings and unique executions
remain immutable after permanent never-signed authority loss. No duplicate
request, renewed source or automatic refund is an upgrade fallback.

Coordinate backend, workers and both clients for
`/api/v1/tokens/register-paid-issues/`. Fresh legacy staff paid ISSUE review,
admission and allotment controls are retired together. Original technical
recovery, retained ISSUE history, TRANSFER pending #869 and existing financial
receipt/refund producers pending #868 remain. Reversal must refuse retained
company-paid preparations or decisions rather than discard their evidence or
restore fresh staff authority over them. No live migration or financial payment
policy is selected by this implementation contract.

### Company capital increases

`tokens/0102_company_register_capital_increases` adds immutable company capital
proposals, decisions and a nullable association on the existing private execution.
It backfills no company approval; old actors, terms, signatures and receipts remain
original. `tokens/0103_company_register_capital_guards` binds new preparation,
decisions, application and fresh signatures to exact current company authority,
retained evidence and coherent before-cap plus delta equals target. Capital mints
zero shares and records no payment, holding or issue.

Release backend, workers and both clients together. New clients use the six-operation
`/api/v1/tokens/register-capital-increases/` family. The fresh owner create and submit
POSTs are retired; their private history GET remains. The technical original retry
and recovery journal stays separate from the company's human approval/application.
An older backend cannot serve the family, and an older client cannot use its retired
fresh submission path on the new backend. Paid issuance retains its existing
guards until its own increment; pause has its coordinated upgrade below.

Both `0103` and `0102` reversal refuse any retained company preparation, decision
or nonnull original execution source, including rejected and never-applied work.
Only an empty reversal restores the genuine predecessor guards/policies before
dropping empty new records and their association. Preserve database and private
storage together; do not delete records to make reversal succeed. Actual migration,
role/catalogue, source/deferred, reversal, original recovery and finality checks
belong to the pull request. These instructions authorise no live migration.

### Company pause and unpause

`tokens/0104_company_register_pause_changes` adds immutable company proposals,
decisions and nullable original sources to the retained pause journal. It
backfills no approval, actor, evidence or signed transaction. `0105` binds fresh
admission, application, new signatures and default-deferred effects to the exact
company source. Both guards refuse reversal with any retained company proposal,
decision or source, including rejected or never-applied records. Only empty
reversal restores the original predecessor definitions before dropping empty
new records and their association; preserve database and private storage together.

Release backend, workers and both clients together. New clients use
`/api/v1/tokens/register-pause-changes/`; old clients cannot create fresh issuer
work on the new backend. Exact retained issuer-row replay/GET and five-field
reminders keep their original identity and direction. Company reads use current
appointments, independently of owner-only legacy history. Original signed
recovery and scoped issuer projection remain, with no fallback or invented
company authority. The [pause guide](../plans/company-managed-registers/company-pause-changes.md)
records observation, receipt, temporary hold and unsigned retirement boundaries.
Final source review, fresh migration/roles/catalogue, authority/deferred, history,
process and isolated real-chain evidence belongs in the pull request. These
instructions authorise no live migration.

As each remaining phase lands, add its actual migration identifiers, coordinated
release order, rollback limits and verification commands here. These notes do not
authorise staff to manufacture company appointments or approvals while the
company tools are missing.

## Retired asset and portfolio HTTP routes

The paper client cleanup removes the unused asset detail and asset snapshots
GET routes, portfolio snapshots GET route, and favourite-assets list, create,
detail and delete routes. These paths now return 404. The retirement itself
needs no database migration: asset snapshots, their administration and the
account export remain available. The favourites table and the holding snapshots
behind the value series outlived their routes with no reader, so the
[`users/0026`, `wallets/0022` and `shared/0013` migrations](#database-migrations)
drop both tables, and the value-series service goes with them.

`GET /api/assets/` and `GET /api/assets/exchange-rates/` remain available for
Wallets and Buy crypto. Portfolio CRUD and the documented operator
`add-wallet` and `remove-wallet` actions retain their contracts. Any external
consumer of a retired route must stop using it before upgrading.

## Retired trading, company, device-token and file HTTP routes

The backend tidy-up removes the routes that no client, documented consumer or
operator script called: `POST /api/v1/trading/transfers/prepare/` and
`/broadcast/` (the clients send through
`POST /api/wallets/{uuid}/prepare-transfer/` and `/broadcast-transfer/`, which
refuse a share class),
`GET /api/v1/trading/tokens/{uuid}/market-data/` (the market list and detail
carry `lastPrice`, `bestBid` and `bestAsk`),
`GET /api/v1/trading/orders/{uuid}/modifications/`,
`GET /api/v1/companies/{uuid}/stats/`,
`GET /api/v1/companies/{uuid}/application-status/` (the company detail carries
the same status, timestamps and flags except `reviewCompletedAt`), the
`/api/device-tokens/` list, create and detail routes (`register/` and
`unregister/` remain),
`GET /api/investor-classifications/{uuid}/evidence/` and
`GET /api/v1/documents/{uuid}/file/`. These paths now return 404, and the
classification and personal-document responses no longer carry `evidenceUrl`
or `fileUrl`; staff read both files through admin. No database migration is
needed. Any external consumer of a retired route must stop using it before
upgrading.

## The company API key is gone

Nothing authenticated with the key a company was issued at registration, so it
is removed. `GET` and `POST /api/v1/companies/{uuid}/api-key/` return 404, the
company admin no longer shows an API Access section, and
[`companies/0011`](#database-migrations) drops the key and its creation time.
Any script that read or regenerated a key must stop before upgrading.

## Theme and selected-portfolio preferences

Both clients are paper only and neither reads a portfolio selection, so the
account's saved theme and selected portfolio are removed, and
[`users/0028`](#database-migrations) drops them. `/api/user-preferences/` now
answers `uuid`, `userProfile`, `userAccount` and `transactionAlerts`; a request
that still sends `theme` or `selectedPortfolio` is answered 200 and the field is
ignored. The account-data export loses its `preferences` section, which held only
the selected portfolio. A new wallet still joins a portfolio: the account's
first, the one sign-up creates, which is where sign-up pointed the selection and
no client changed it. No client is affected.

## Retired HTTP methods no client calls

The routes below keep the methods the clients use and lose the ones nothing
called: `PUT` where the clients send `PATCH`, deletion of companies and share
classes, editing share classes (every field of the class detail was read-only,
so a `PUT` or `PATCH` changed nothing), editing and deleting capital increase
drafts, the user preferences detail, reads of single rows and the company
documents list that the clients take from a list or a detail, a profile create
that sign-up never used, and the cancel-message `GET` that only refused old
clients. A path that keeps another method answers 405 to a retired one; a path
left with none answers 404. No database migration is needed.

| Answers 405                                                            | Keeps                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET` and `PUT /api/financial-profiles/{uuid}/`                        | `PATCH`                                              |
| `GET` and `PUT /api/user-profiles/{uuid}/`, `POST /api/user-profiles/` | `PATCH`, the list, `delete-account/`, `export-data/` |
| `GET /api/user-accounts/{uuid}/`                                       | `PATCH`                                              |
| `GET /api/notifications/{uuid}/`                                       | `PATCH`                                              |
| `GET /api/investor-classifications/{uuid}/`                            | `DELETE`                                             |
| `GET` and `PUT /api/wallets/{uuid}/`                                   | `PATCH`, `DELETE` and the wallet actions             |
| `PUT` and `DELETE /api/v1/companies/{uuid}/`                           | `GET`, `PATCH` and the application actions           |
| `GET /api/v1/companies/{uuid}/documents/`                              | `POST`; the company detail lists the documents       |
| `GET /api/v1/companies/{uuid}/documents/{uuid}/`                       | `DELETE` and `file/`                                 |
| `PUT /api/v1/offerings/{uuid}/`                                        | `GET`, `PATCH`, `DELETE`                             |
| `PUT`, `PATCH` and `DELETE /api/v1/tokens/{uuid}/`                     | `GET` and the class actions                          |
| `GET /api/v1/trading/orders/{uuid}/cancel/message/`                    | `POST`, which issues the cancel challenge            |

`GET /api/feature-flags/{uuid}/`, `/api/transactions/{uuid}/`,
`/api/v1/tokens/issuance-requests/{uuid}/` and `/api/v1/trading/orders/{uuid}/`
answer 404; their lists stay. `/api/user-preferences/{uuid}/` answers 404 to
every method; the clients read the list and save with `POST`, which stay.
`/api/v1/tokens/capital-increases/{uuid}/` answers 404 to every method; the list,
the create and `submit/` stay, and the detail a create or submit answers no longer
carries `canBeEdited`, which only described the retired edit; `canBeSubmitted`
stays. The company and share-class deletion refusals,
`company_holds_a_register`, `company_holds_share_classes` and
`deployed_share_class`, are gone with the routes: the API deletes neither, so
[the register's deletion protection](../architecture/register.md#deletion-protection)
now rests on the protected relations alone. Delist a company that should close.
Any external consumer of a retired method must stop using it before upgrading.

## Stablecoin sends need an approval on both sides

`POST /api/wallets/{uuid}/prepare-transfer/` and `/broadcast-transfer/` now
refuse a stablecoin transfer (asset type `stablecoin`, today AUDY) with 403 and
code `stablecoin_approval_required` unless the sending wallet and the recipient
each hold a live approval with at least one company. The message says which
side lacks one. This is the
[company-scoped approvals](../decisions.md#company-scoped-approvals) rule the
retired trading transfer route used to enforce; Wallets > Send, where the
clients send, never did. A transfer to the operator's receiving wallet, on the
chain it is configured for, is exempt on both sides, so an investor can pay a
subscription to the address its payment instruction names without an approval;
an unset receiving wallet, or one on another chain, exempts nothing. Native
coins and other tokens are unaffected, and a submission recorded before the
upgrade is still delivered. `prepare-transfer` now also answers 400, "The
recipient is not a valid address for this wallet's network.", for a recipient
that is not an address on the wallet's network, where before a Bitcoin prepare
accepted any string. No database migration is needed.

## The publication summary's 30-day count

`GET /api/v1/publications/summary/` no longer answers `publishedSince`; Holdings
lists the three latest notices instead. Clients built before this change read the
missing count as 0 and show nothing in its place. No database migration is needed.

## Retired transaction cleanup tasks

`blockchain.tasks.cleanup_failed_transactions` and
`wallets.tasks.confirmation.cleanup_stale_pending_transactions` are removed. No
code enqueued them; they remained only to report overdue counts for jobs older
workers had queued. Do not run such jobs on an older release to clear them:
releases before 10 September 2026 ran them as a daily timeout that marked pending
transactions as failed. Before upgrading, look for queued jobs under either name
and delete them:

```sql
select id, task_name, status from procrastinate_jobs
where task_name in (
  'blockchain.tasks.cleanup_failed_transactions',
  'wallets.tasks.confirmation.cleanup_stale_pending_transactions'
) and status = 'todo';
```

A job left behind is harmless: a worker without the task marks it `failed` and
runs nothing. No database migration is needed.

## Prepared transfers carry the exact amount in wei

`POST /api/wallets/{uuid}/prepare-transfer/` now answers an EVM transaction's
`value` as a JSON-RPC hex quantity of wei, for example `"0x8ac7230235dc1c00"` for
9.99999999 ETH and `"0x0"` for a token transfer, where it answered a JSON
number. JavaScript reads a number above 2^53 approximately, so a client could
sign a different amount from the one prepared. Native amounts are also
converted exactly: one with more than 18 decimal places is refused with 400
instead of being rounded, and `amountEth` and `amountToken` are written in plain
decimals. `gas`, `gasPrice`, `nonce` and `chainId` stay numbers, far below
2^53.

Clients built before this change fail closed or sign exactly. An older
dashboard builds its Keystone code from `'0x' + value.toString(16)`, which gives
`0x0x…` for a hex string, so it shows "Failed to encode transaction for
signing" and sends nothing. An older mobile build's software Send fails before
signing, whatever the value. Its Keystone code reads the hex string exactly,
but its decoder refuses the longer signature the Keystone returns on the test
networks. A decimal string would have been the risky form: an older dashboard
reads its digits as hexadecimal, so a stale tab would have signed 0.001 ETH as
1.152921504606846976 ETH. Current clients still read a safe JSON number from an
older backend. No database migration is needed.

## Finished job records are removed

The worker now runs `remove_old_jobs` daily at 04:30 UTC, which deletes
succeeded job records seven days after they finished and failed, cancelled and
aborted ones thirty days after; [the job schedule](jobs.md#removing-old-job-records)
says why. Nothing removed them before, so the first run after the upgrade
deletes the whole backlog in one statement, which can take a minute on a
deployment that has run for months. Copy any older records worth keeping out of
`procrastinate_jobs` and `procrastinate_events` before upgrading. No database
migration is needed.

## Database migrations

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
- `portfolios/0005_delete_portfoliosnapshot` drops `portfolio_snapshots`. At the
  time, the value series was computed on read from holding snapshots, which kept
  `GET /api/portfolios/{uuid}/snapshots/` compatible; the later
  [route retirement](#retired-asset-and-portfolio-http-routes) removed that HTTP
  surface, and `wallets/0022` below removes the snapshots and the service. The
  nightly `sync_all_portfolios` periodic job no longer exists: delete any queued
  Procrastinate jobs under that name.
- `users/0026_delete_favouriteasset` drops `favourite_assets` and
  `wallets/0022_delete_holdingsnapshot` drops `holding_snapshots`. Nothing read
  either table; the hourly `sync_all_wallets` job, history imports and transfer
  confirmation stop writing holding snapshots, and the manual sync result no
  longer reports a `snapshots` count. `shared/0013_policies_without_the_dropped_tables`
  reinstalls the row-level-security catalogue without their policies and runs
  after both drops. **Reversal does not restore data.** Both drops are
  `DeleteModel`, so reversing them recreates the two tables empty and outside
  the policy catalogue, and none of the rows. Export anything in either table
  worth keeping before applying them.
- `users/0027_transaction_alerts_on_user_preferences` moves the transaction-alerts
  switch onto `users_userpreferences`: it adds the `transaction_alerts` column,
  on by default, copies each `users_notification_preferences` row's value onto
  the same person's preferences row, creating that row with the model defaults
  when the person had none, then drops `users_notification_preferences`. A
  person with no notification row keeps the default. `/api/notification-preferences/`
  returns 404; `/api/user-preferences/` carries `transactionAlerts` instead, and
  the notification-preferences admin page and its bulk actions are gone.
  `shared/0014_policies_without_notification_preferences` reinstalls the
  row-level-security catalogue without the dropped table's policies and runs
  after it. **Reversal does not restore data.** The copy step reverses as a
  no-op and the column drop takes every carried value with it, so reversing
  recreates `users_notification_preferences` empty and outside the policy
  catalogue and puts everyone back on the default. Export that table before
  applying the migration if you may need to reverse it.
- `users/0028_remove_theme_and_selected_portfolio` drops `theme` and
  `selected_portfolio_id` from `users_userpreferences`; every row and its
  `transaction_alerts` stay. **Reversal does not restore data.** It recreates
  both columns, sets every theme to `dark`, the old default, and selects each
  account's first portfolio, which is what sign-up selected; a person with no
  account or no portfolio selects none. A `light` theme or another selection
  saved before the upgrade is gone.
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
  [opening is applied](register-foundation.md#opening-the-register-from-the-chain).
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
  page, historically opened by **Can change register outputs**. The later
  [company inspection-copy increment](../plans/company-managed-registers/company-inspection-copies.md)
  retires that preparation form while preserving these records and constraints.
  Reversal refuses once any inspection copy exists.
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
- `tokens/0076_transfer_instructions` adds the `transfer` kind of
  [register instruction](register-foundation.md#register-instructions-for-transfers)
  and replaces the `0073` instruction guard's function in place. It now checks a
  transfer instruction's items when one is inserted, and at application that each
  listed settlement is completed in the class on its listed terms and that no
  other applied instruction covers it. It rewrites no existing row. From then on
  a settlement's transfer entry is recorded only once an applied transfer
  instruction lists it; transfer entries already recorded stay as they are. A
  settlement that completed after its class's opening but is not yet recorded
  when the upgrade lands, such as one waiting for a wallet link or behind an
  earlier effect, now also waits for an instruction, and holds later issues and
  transfers in its class behind it. Find each on the waiting list, where it shows
  as `uninstructed` once nothing else holds it, and submit an instruction for
  each settlement the directors approve. Run the new code with the migration: an
  older binary still records settlements without an instruction. Reversal
  refuses once any transfer instruction exists.
- `tokens/0077_import_opening` (#647) lets a
  [register import](register-foundation.md#importing-an-existing-register) open
  a share class not yet on chain: one with no register entries, no issuance
  request ever approved and no applied register instruction. It changes no
  schema and rewrites no row; it replaces the import guard function `0072`
  installed and the instruction guard function `0076` installed, without editing
  either migration. The import guard now admits an import for such a class that
  names new members or the company's own, never another company's, and admits
  its application only when the register's only entry is exactly the opening
  that import records, with still nothing approved. An import for an opened
  class keeps its rules, and its application now also refuses a former member
  who ceased on or after the opening. The instruction guard refuses to apply any
  instruction for a class an import opened. Apply it with the new code: the
  earlier guard refuses to store an import for an unopened class, so submitting
  one fails until it runs. Such a class reads a waiting count of 0 while nothing
  has completed on chain, and its CSV says `not on chain` for the reconciliation
  and the fold. Reversal restores the earlier functions exactly, and refuses
  once an import has opened a register, because the earlier instruction guard
  would admit an instruction for it.
- `tokens/0078_register_notice_figures` adds the `notice_figures` kind of
  register export, a nullable `period_from` column and two check constraints: a
  notice-figures record carries a digest, an instruction and a period, and no
  former rows, request date, recipient or late flag; no other kind carries a
  period. It rewrites no existing record, which is a CSV export, an inspection
  copy or a certificate and has no period. The
  [Register outputs](register-foundation.md#preparing-notice-figures) page gains
  **Prepare notice figures** under the existing **Can change register outputs**
  permission. Reversal refuses once any notice-figures record exists.
- `tokens/0080_company_pack` (#650) adds the `company_pack` kind of register
  export and its check constraint: a company-pack record carries a digest, an
  instruction and a recipient, and no request date or late flag. It installs
  `tokens_register_entry_preimage(tokens_registerentry)` beside the entry hash
  function, which is unchanged. It rewrites no existing record, none of which is
  a company pack. Reversal refuses once any company-pack record exists, and
  otherwise drops the function.
- `shareholders/0005_publication_event_preimage` (#650) installs
  `shareholders_publication_event_preimage(shareholders_publicationevent)`
  beside the publication event hash function, which is unchanged. It returns
  the text the hash function digests, under either version tag, for the
  [company pack](../architecture/company-pack.md#publications). It changes no
  table or row. Reversal drops the function.
- `companies/0010_company_pack` (#650) adds the `CompanyPack` proxy of `Company`,
  which creates no table, only the **Can change company pack** permission and
  the proxy's other defaults. Grant it, with **Can view company document**, to
  the staff who [produce company packs](register-foundation.md#producing-a-company-pack).
- `companies/0011_remove_company_api_key` drops `api_key` and
  `api_key_created_at` from `companies_company`. It rewrites no other column.
  **Reversal does not restore data.** It recreates both columns and issues
  every company a new random key dated at the reversal, which the unique
  constraint needs; the keys dropped are gone.
- The [company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md)
  adds `wallets/0024`–`0025` and `whitelist/0010`–`0011` after the company
  empty-deployment foundation. These retain genuine successful possession proof,
  explicit participant nomination, company instruction/decision and a nullable
  original `WhitelistChange` source. Apply the coordinated backend/worker/client
  release; old fresh staff/owner admission is not a fallback. No historical
  VERIFIED status, signature, actor, approval or treasury record is backfilled
  into invented proof/company provenance. Existing changes, approvals, wallet
  identities and signed bytes remain. Empty reverse/forward preserves legacy
  records; retained new proof/source/decision history prevents destructive
  reversal. This is a preservation migration, not a new global-registry fresh
  start. The owning PR records actual migration checks and rollback limits.
- `whitelist/0007_per_company_approvals` is a fresh start: it refuses to run while
  any whitelist change exists, because those were written for the retired global
  registry. Follow the [fresh-start redeploy](chains.md#fresh-start-redeploy).
  It drops the entry's status, membership, sync and transaction-hash columns,
  creates `WhitelistApproval`, adds the company and expiry to `WhitelistChange`
  and replaces its guard. Reversal refuses once any change exists.
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
  `POST /api/v1/trading/orders/create/` would refuse every order for want of a
  configured settlement asset and the wallet balance endpoint would stop
  listing them. Confirm the
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
[EVM journals](../reference/wallet-transfers.md#evm), [Bitcoin journals](../reference/wallet-transfers.md#bitcoin),
[chain observations](../reference/transaction-evidence.md), and [mint recovery](recovery.md#deployment-and-issuance).
