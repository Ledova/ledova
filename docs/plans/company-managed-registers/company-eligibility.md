# Company eligibility records

[Implementation index](README.md) · [Company activation](company-activation.md)

Participant requests and personal company decisions retain their exact company,
source and action scope. [PR #915](https://github.com/Ledova/ledova/pull/915)
delivered the records and API foundation; [PR #917](https://github.com/Ledova/ledova/pull/917)
implements the coherent [#863](https://github.com/Ledova/ledova/issues/863) cutover
using current decisions for the bounded consumers below. Wallet possession
and technical company wallet approval remain separate; eligibility cannot add or
renew a wallet approval.

## Requests and company decisions

An authenticated holder previews their own retained classification source for
one known active company. A product-value claim instead selects an approved
offering and whole-share quantity; the server derives its company, token,
price, currency, amount and exact terms. The amount must reach AUD 500,000.
Accountant certificates retain their actual certifier fields and two-year
boundary. Associated-person claims name their actual issuer.

The participant confirms the rendered declaration and sharing summary, exact
preview digest and request key. Submission retains that summary, opaque hashes
of source metadata and actual evidence bytes, its requested expiry and actual
holder. It does not change the source into a global verification or approval.
Company readers receive the summary and outcome history, without private files,
financial basis, provider results or source-document metadata.

Current personal `prepare` or `approve` for the exact company permits queue
reads and decision previews. A new decision requires personal `approve`, the
exact selected appointment, digest, request key and explicit confirmation.
Acceptance requires current configured identity, account standing, available
unchanged evidence and exact scoped terms, with expiry bounded by the request,
source and certificate. Refusal records a nonblank reason and no permission or
expiry. Staff status, ownership, administration, delegatable-only capabilities
and shareholding do not supply this approval.

The holder can withdraw a pending or accepted request. A refusal remains visible.
A current personal approver can revoke an acceptance with a retained reason.
Requests, decisions, withdrawals and revocations are append-only and keep their
actual actor, appointment, request key, digest and database-stamped clocks.
Identical retries return retained results through current read permission after
new-effect conditions change; changed parameters conflict and never substitute
a replacement appointment.

## API

Participant routes use `/api/v1/company-eligibility/requests/`: list, detail,
`preview/`, creation and detail `withdraw/`. Company routes use
`/api/v1/companies/{company_uuid}/eligibility-requests/`: list, detail and detail
`decision-preview/`, `decide/` and `revoke/`. Inputs use the existing camel-case
JSON contract and reject unrecognised fields. Creation returns 201, exact replay
200; stale confirmations return 409, unmet requirements 400, and inaccessible
records 404. The generated OpenAPI snapshot defines the complete shapes.

## Browser and mobile workflow

Both clients expose **Your company eligibility** from the private evidence page.
The participant selects their own submitted or current verified source, enters
one known company UUID or an approved offering UUID and whole-share quantity,
and requests an expiry. The server preview supplies the actual declaration,
sharing summary, product terms and unmet requirements. Separate sharing and
declaration checks confirm that exact preview before submission. Own request
lists, detail, outcome history and explicit withdrawal remain available.
Multiple submitted sources are permitted. Source upload and private evidence
history retain their controls; company acceptance does not mark a source globally
verified.

Associated-person source uploads name the issuer using the company-provided UUID.
Both clients require a valid UUID without reading the company administration list
or requiring an existing eligibility decision. The server accepts only an active
issuer; this bounded lookup does not reveal company metadata or expand directory
access. The company remains the exact target of any later sharing request.

**Company eligibility** is reachable from Holdings and Company team in both
clients, including an investor's mobile Home stack. It derives company choices
from the caller's own current personal prepare or approve appointments without
an owner-company listing or administrator-only read. The caller chooses their
exact appointment, reads the company queue and request summary, and previews an
acceptance with bounded expiry or a refusal with its reason. Prepare-only users
see unmet personal approval and cannot confirm a decision. Decisions and
reasoned revocations require explicit confirmation; history retains the actual
appointment, actor, clocks, keys and digests.

One shared client lifecycle binds previews and writes to the current session,
account, source, company, offering, quantity, request and selected appointment.
Changing a binding or closing a confirmation retires held callbacks before
dispatch. An uncertain transport outcome retains the original payload and key
for identical replay within the running client session, including navigation
away and back. A reload or application restart requires inspecting retained
history; this slice adds no durable local command store. Company response views
render only the permitted summary and outcome history.

These forms submit retained eligibility requests and company decisions.
Directory, market, subscription and new order/signature effects use current
exact-company decisions. The account-readiness response (`account`, `isReady`,
`reasons`) concerns login, account standing and configured identity; it supplies
no company permission. Streams authenticate a fresh JWT and live refresh session
before connection, matching events and heartbeats, and recheck current decision
and evidence. Cached Django session users do not authenticate the stream.
Company-managed offering, issuance and register workflows remain planned under
#864–#873. Browser/mobile source and synthetic tests do not establish native builds,
physical-device acceptance, fresh external-provider checks or live operation.

The service and statement guards acquire the bounded company/product,
account/actor/profile, settings, appointment, source/document and retained-record
prefix before new effects. Post-wait checks refuse changed bindings and use the
current clock. Application-role writes cannot forge standing, identity policies,
source payloads or company decisions. The privileged executor still requires the
actual principal and exact personal mandate. SQL validates relational metadata;
bounded services read actual stored bytes under the evidence locks.

## Evidence and upgrades

New source uploads retain their actual holder, declaration and submitted bytes.
Withdrawal records the actual holder rather than inventing a reviewer. The first
company request freezes further supporting attachments. Source and attached
document records, read audits and eligibility history remain retained. Retention
removes due private files and derived extraction payloads after fresh database
checks under the source/document locks. A caller-supplied future batch time or
retention setting cannot authorise
early physical deletion. Missing bytes and storage failures remain observable.

`users/0032_company_eligibility_records` adds the four record tables and nullable
source withdrawer without inferring historical actors or approvals.
`users/0033_company_eligibility_guards` installs evidence/command guards and
protected retention constants from the actual configuration. Zero days retains
evidence indefinitely. Changing either retention period or the certificate
time zone requires an explicit guard migration and a coordinated backend/worker
upgrade; configuration mismatch refuses new effects. Stop old writers before
applying the new guarded boundary, and back up database and private storage
together. Existing migrations and retained records remain unchanged.

Empty reversal preserves the old source data. Once new records or actual source
withdrawal attribution exist, reversal refuses to discard their history or
protections. Rehearse upgrades and empty/populated reversal with ordinary/scoped,
role/catalogue, isolation, SQL forgery, clock and real contention controls before
release. The pull request records actual checks and remaining verification gaps;
implemented forms do not replace the later complete web/mobile journey evidence.

## Consumer and source cutover

General accountant/professional decisions can support secondary admission.
Associated-person decisions are issuer-bound primary eligibility; product
claims bind the actual offering, quantity, AUD amount and terms. New
subscriptions, order creation, modification and swap signature effects retain
their actual company decision and recheck evidence, standing and current expiry
after waits. Directory and market admission is limited to the company or exact
product covered by the current decision; another company's acceptance supplies
no permission. Subscription draft, submission and acceptance also require an
approved offering within its opening period, a deployed token with a contract
and an active issuer open to investors. Eligibility grants no offering publication
or technical acceptance authority.

Losing investment eligibility does not hide the holder's retained subscription,
order or swap records. Historical rows keep NULL provenance. Already paid
subscriptions and submitted chain transactions retain their original execution
and recovery paths; migrations infer no decisions for old records.

Multiple submitted private sources are permitted. Company acceptance does not
mark a source globally verified. Historical staff review fields remain; new
staff review commands and mutable admin actions are retired. Holder withdrawal,
sharing freezes, private access and retention continue to apply.

Company revocation, holder source/request withdrawal, expiry and actual account,
identity or wallet loss retain their genuine cause. Loss producers capture
original facts before the change in the same bounded transaction and dispatch
after commit, preserving the actual holder, permitted staff actor or explicit
provider automation. Deferred guards require the declared loss and exact model
permission. Workers use the restricted operator in autocommit, recover the
original unresolved outgoing transaction first and admit only `REMOVE`; they
cannot add or renew approval.
Another current general decision prevents decision-based removal. A legacy
approval lacking a retained cause is reported without inventing an actor.

SQL checks relational metadata; services hash actual storage bytes. Changed bytes
under otherwise live metadata require reconciliation and do not justify an
invented removal cause. Storage and chain failures remain observable. Synthetic
fixtures obtain real holder requests and nonstaff company decisions; maintenance
is confined to historical states, without manufacturing current consent or
admission provenance.

The additional migrations are `shared/0015`, `users/0034` and `0035`,
`offerings/0010`, `tokens/0082` and `whitelist/0009`. The shared replacement keeps
original migration history and the queue prerequisite while supporting a fresh
schema. Reversal refuses incompatible retained history. Database/private-storage
backups, live migration and signer activation remain owner-directed.
