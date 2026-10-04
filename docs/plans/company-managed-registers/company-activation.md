# Company activation

[Implementation index](README.md) · [Company information](company-information.md) · [Authority requests and appointments](authority-requests.md)

A current personal company administrator can activate a company in web and
mobile after accepting the exact declaration and meeting the configured identity
and ABR requirements. Company information remains provided by the company.
Activation establishes no offering publication, share issue, payment, participant
eligibility or wallet approval. Company-specific eligibility remains separate
work in [#863](https://github.com/Ledova/ledova/issues/863).

## Web and mobile

1. Complete signup, email verification and the configured identity verification
   through your own account. Establish initial authority through the existing
   self-declaration workflow or accept a valid administrator invitation.
2. Open **Company** → **Activation**, select the company, and refresh its current
   appointment and company details. An appointed investor can use the same screen;
   a company account role or owner draft does not substitute for an appointment.
3. Choose **Review activation**, read the selected company and exact declaration,
   explicitly accept it, and confirm once.
4. Read the retained outcome. A passing applied attempt makes the company ACTIVE.
   Pending, failed or unconfigured checks leave its previous status unchanged.
   Resolve the stated requirement before reviewing a new provider attempt.

Changing the account, session, selected company, appointment, company identity,
revision or declaration invalidates an open confirmation. Failed reads disable
submission. The clients recheck current access before transport, reject repeated
confirmation dispatch and validate the receipt's company, appointment, request
key, revision and declaration. An uncertain transport outcome retains the key
for the same unchanged request; a confirmed pending/failed result can be followed
by a newly reviewed attempt. Private readiness and attempt displays disappear
when personal administrator access ends, even if basic draft preparation remains
available.

Existing submission, review, approval, rejection and withdrawal dates and reasons
remain a historical record. Company files remain in **Company**, with their
existing authorization and retention controls. The old nine listing uploads,
owner submit/resubmit/withdraw actions and staff initial review/approval/activation
are retired. Historical migrations and retained actors/documents are preserved.

## API and durable outcome

`CompanyDetail.activation` is nullable. Current personal administrators receive
the appointment, company revision, exact declaration and their own latest attempt
for that appointment. Private identity snapshots and another representative's
attempts are not returned. Missing configured identity verification redacts this
readiness; an otherwise valid administrator activation request receives the
existing actionable identity-required error before provider work.

`POST /api/v1/companies/{uuid}/activate/` accepts this rendered JSON shape:

```json
{
  "idempotencyKey": "request UUID",
  "appointment": "current appointment UUID",
  "lifecycleRevision": 0,
  "declarationVersion": "2026-10-04",
  "acceptDeclaration": true
}
```

A 200 response contains `message`, `company` and `attempt`. The attempt records
its UUID, request key, appointment, source revision, pending/passed/failed status,
reason, start/completion/application times and exact declaration. A pending or
failed outcome is still a retained attempt, not a successful activation.
Foreign, expired or revoked sources are hidden/refused; stale or changed requests
return `company_activation_conflict` (409). Reusing the same key and exact request
returns the recorded attempt without another provider call or effect. A passed
but unapplied attempt can resume its final effect after a transient commit failure,
subject to every current authority, identity and company check.

The service locks the company and current actor/profile/settings, validates the
exact personal appointment and records the attempt before releasing the
transaction. ABR runs outside SQL locks and transactions. The final transaction
locks and rechecks those inputs and the selected attempt, using the current time
after lock waits. Expiry, revocation, identity/configuration changes or stale
company identity/revision prevent a new effect. The company ACTIVE transition
and immutable `appliedAt` receipt commit together. Database guards refuse forged
provider decisions, raw application-role effects and orphan applied receipts.
Receipt identity must equal the exact four-field company snapshot, including its
normalized name. Database name comparison uses NFKC, a frozen Unicode 15.1 full
case-fold map and the same whitespace collapse as the existing Python identity
function. Receipt writes lock the declared company before any receipt row,
preserving the service's lock order.

## Upgrade and technical recovery

Migration `0021_company_activation` adds attempt provenance and effect guards
without creating historical declarations, provider passes, approval dates or
activation actors. Existing statuses, documents, checks, actors and earlier
journey evidence remain retained.

Staff technical warning, suspension, delisting, registry retry and recovery remain
available within their existing model permissions. Recovery requires a fresh
matching ABR check and either the company's genuine applied initial activation
provenance or its historical officeholder attestation. These controls cannot
initially activate a new draft or become company appointment authority. See the
[registry integration procedure](../../operations/integrations.md#company-registry-verification)
for configuration, lookup limits and pending/refused outcomes.
