# Company eligibility records

[Implementation index](README.md) · [Company activation](company-activation.md)

This foundation records participant requests and personal company decisions.
It supplies no investment permission. Existing global classification consumers,
staff classification review, the one-open-submitted-source rule and client flows
remain until the coherent conversion in [#863](https://github.com/Ledova/ledova/issues/863).
Wallet possession and company wallet approval remain separate.

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
release. This foundation does not establish fresh provider, web/mobile journey,
physical-device or live-operation acceptance.
