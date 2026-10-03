# Representative authority requests

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md)

The initial increments of [#862](https://github.com/Ledova/ledova/issues/862) record
private evidence of a proposed company appointment and let its requester withdraw
it. A request is **pending verification** until withdrawn; it grants no company
authority in either state. The repository has no
configured representative-mandate verifier. KYC, company identity checks and
historical staff attestations do not supply that missing result.

Use synthetic people, companies and evidence in this experimental implementation.

## Company user steps

1. Sign up, verify your account email and register a draft company.
2. Open **Representative authority** from the company details screen on web or
   mobile. Select the draft company you own; selection is explicit when you have
   several companies.
3. Choose the actions you propose to exercise and, separately, the actions you
   propose to delegate. These are requested scopes, not permissions granted by
   selecting them. You may propose an expiry.
4. Upload the supporting PDF, PNG or JPEG through the existing checked upload
   flow. The file is private and retained with the request.
5. Submit. The platform records the company and person snapshots, requested
   terms and exact evidence bytes, then displays the pending verification result.
6. Review **Your requests** and download your retained evidence. A request keeps
   the company name and ACN captured when it was submitted. Retained submissions
   cannot be edited or deleted through the clients.
7. If a proposal is no longer wanted, choose **Withdraw request** in its history.
   The recorded state becomes **Withdrawn** with its original withdrawal time.
   Evidence remains available. Submit a new request to propose authority again.

```mermaid
flowchart LR
    signup[Sign up and verify email] --> draft[Register a draft company]
    draft --> select[Select owned draft company]
    select --> terms[Propose personal and delegation scopes]
    terms --> evidence[Upload private evidence]
    evidence --> capture[Retain exact request and evidence]
    capture --> pending[Pending independent verification]
    pending --> history[Read own request and evidence]
    pending --> withdraw[Withdraw unwanted request]
    withdraw --> history
```

Company appointments, invitation acceptance, effective capabilities, revocation
and representative recovery remain later increments of #862. Company activation,
register decisions and payments retain their current workflows until their
owning issues replace them. See the [dependency index](README.md#delivery-tracking).

## API and retained records

`/api/v1/company-authority/requests/` provides authenticated multipart submission
and paginated personal history. Detail and file actions resolve only the caller's
own request. Active accounts with verified email are required; a new submission also
requires current ownership of the selected draft company. Public company
visibility, shareholder records and staff permissions do not widen that scope.

The server resolves the person and profile, validates the upload and freezes the
raw and normalised identities, file SHA256/size/type, requested scope and expiry.
It accepts no caller-supplied verification result or representative account.
An identical retry under the same requester-scoped idempotency key returns the
retained request, including after its company leaves draft or changes owner.
Retries compare the exact incoming bytes, filename, declared MIME type and terms
with the retained digest and current company/person identities. They do not scan
the same retained evidence again, so scanner unavailability does not prevent an
identical retry. Bounded input capture and the current account checks still apply.
New keys require successful upload validation and current draft-company ownership.
Changed evidence, terms, company or captured identity conflicts;
submit a new request for changed information. Clients preserve a key for retries
and replace it when inputs change.

`POST /api/v1/company-authority/requests/{uuid}/withdraw/` accepts an empty body
and returns the request with its derived `withdrawn` state and `withdrawnAt`.
Initial and repeated withdrawals return HTTP 200 with the same recorded time.
Only the original requester can withdraw, including after the company changes
owner or leaves draft status. A retry of the original submission returns its
withdrawn record; it cannot reactivate it or upload another copy.

`companies/0012_company_authority_request` adds only the request table, its
requester-only read policy and immutable database guard. Ordinary app SQL cannot
insert or change the retained records. Creation uses a bounded service that
rechecks the exact person/profile/company under locks and carries the person
explicitly across database aliases. It changes no company owner, activation
state, historical decision or register entry.

`companies/0013_company_authority_request_withdrawal` adds one immutable,
requester-private withdrawal record per request. The bounded service locks the
current person and original request; SQL independently checks that principal
and actor match its requester. Ordinary app writes, updates and deletion fail.
The parent request, snapshots, digest and evidence are unchanged.

Requests and their referenced evidence have no automatic purge in this
experimental slice. Submission errors do not immediately delete uploaded bytes:
a COMMIT acknowledgement or principal-restoration failure can occur after the
request has committed. The existing orphan sweep removes only unreferenced
uploads older than its 24-hour grace period; it preserves files referenced by
retained requests, including after an uncertain submission outcome. Requested appointment
expiry or request withdrawal does not delete submission evidence. See [files and retention](../../architecture/files-and-retention.md).

Reversal is allowed only while the new table is empty. A populated reversal
refuses to discard request history and private evidence; retain a database and
private-storage backup together. Follow [upgrade notes](../../operations/upgrades.md).

Withdrawal migration reversal likewise refuses to discard populated withdrawal
history; its empty reversal preserves existing requests and their evidence.
The request guard refuses `null` capability elements from `companies/0014`;
reversing that migration accepts them again, as the upgrade notes describe.

## Remaining verification boundary

A later admission workflow must bind fresh, attributable identity, entity and
representative-mandate results to this exact retained request before creating an
appointment. No successful mock, uploaded declaration or staff override can
complete that boundary. Missing or unavailable verification stays pending.
The original #862 completion checks remain open until the actual verification,
team, delegation, revocation and recovery workflows are demonstrated.

Future admission must lock the same request and reject a withdrawal before
creating authority. After an actual admission commits, it must refuse request
withdrawal and offer the effective appointment's revocation workflow. This
increment implements no admission or appointment, so it proves request
withdrawal, retention and isolation rather than that future admission race.
