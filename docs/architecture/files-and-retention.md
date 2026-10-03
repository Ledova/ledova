# Uploaded files

[Architecture](README.md)

Uploaded evidence is private in every storage mode. File ownership and the
retention clock determine who can read or remove it; a public media URL never
substitutes for an authenticated route.

## Company-managed evidence access

The [company-managed plan](company-managed-registers.md#responsibility-and-company-access)
requires company-scoped document and authority workflows in place of routine
staff review. A company appointment must authorise only the relevant company's
documents and task; it does not grant access to participants' private identity,
classification or financial evidence. Provider facts and the company's decision
must remain attributable and content-bound, with evidence expiry, revocation,
read audits and retention enforced where applicable.

The serving and retention paths below describe current code. Retiring the legacy
product modes keeps supporting evidence available with the current registry
product's private access and review safeguards. Remove the field and mode-only
branches in a coordinated API/client release; do not purge retained content,
relax reviewer restrictions or replace the mode with another product flag.

## Storage and serving

Private `FileField`s declare `storage=private_storage` and `max_length=255`.
`PrivateMediaStorage.base_url` is null, so `.url` raises. Discovery follows the
storage declaration/alias for local, S3 and GCS adapters. Stored keys end in a
fresh UUID and extension; no email or original filename is embedded. Company,
account and classification UUIDs in prefixes remain pseudonymous identifiers.

| Upload | Storage prefix and lifecycle |
| --- | --- |
| Register correction authority | `companies/`; retained request prevents ordinary deletion; interrupted-copy orphans are swept |
| Publication to members | `companies/`; retained with its row until the [publication purge](shareholder-publications.md#retention) |
| Dividend payment evidence | `companies/`; retained with its payment record until the [publication purge](shareholder-publications.md#retention) |
| Company document | `companies/`; swept after becoming an orphan |
| Unattached payslip | `documents/`; ordinary deletion and orphan cleanup |
| Classification evidence | `users/`; retained by the classification clock |
| Attached payslip | `users/supporting-documents/`; retained with its claim |

An authenticated serving action resolves the row before streaming it. Foreign
and phantom customer rows return the same 404; anonymous requests return 401.
Staff read company files through admin rather than widening customer ownership
selectors. `admin_file_path` checks model and object view permission; refused
staff receive 403, matching the change page.

The company document serializer returns the authenticated route as `file_url`;
a personal document and classification evidence are read only through admin.
The dashboard uses a top-level navigation with its session cookie. Mobile
fetches with its bearer client and shares a temporary cached copy; see
[mobile lifecycles](mobile-lifecycles.md).

A company document attached to an approved or closed offering is also served to
the investors the directory admits to that share class, through the directory's
own route and `file_url` ([offerings](offerings.md)), under the same rules: the
row resolves before streaming, and a document that is not published through
that class answers the same 404 as a phantom. Only stored files are served there;
a document held as an external link is not offered to investors. While an
approved or closed offering carries a document, its owner cannot delete it:
the delete answers 409 `offered_document`, and admin refuses it too.
Admin downloads are attachments. Customer serving is inline only for the allowed
PDF/PNG/JPEG MIME types; other or absent types become attachments.
`stream_stored_file`, which every customer file route uses, marks each response
`Cache-Control: private, no-store`, so neither a shared cache nor the browser
keeps a copy; admin downloads, the company pack among them, carry the same
directives through the admin's `never_cache`.

## Deletion and retention

The lifecycle receiver schedules ordinary private-file deletion on commit so a
database rollback cannot restore a row whose bytes were already destroyed.
The nightly orphan sweep handles files left without rows by interrupted writes.
It walks only swept prefixes and requires 24 hours without a change, protecting
the interval between file write and row commit. New private fields must be swept
or explicitly classified as retained, with a reason.

Classification evidence outlives account deletion. A submitted claim is
withdrawn rather than hard-deleted; admin deletion is refused and its account
link is protected. The serving horizon and purge service share one clock.
Read paths refuse evidence immediately after that horizon; the sweep deletes
bytes later, preserving status and content-free metadata.

Supporting payslips attach once to an accessible, submitted classification.
Attachment copies bytes to retained storage and deletes the old copy only on
commit. It neither verifies the claim nor changes eligibility. Cascades cannot
delete an attached row that still holds content. After the claim horizon, purge
removes the file, extraction output, filenames and notes while retaining claim
links and read audit. Storage failures leave a retryable reference. Unattached
files use their own shorter upload-age clock.

Permitted document-operations staff read attached payslips and extraction history.
Company owners and company-role accounts do not gain that cross-customer access.
Every operations page/file/extraction/changelist read records `DocumentRead`;
an audit write failure refuses delivery. Audit rows survive content purge and
have no admin mutation path. Supporting evidence uses these same controls on
hosted and private instances. Product-mode selection and its evidence-only
restrictions are [retired](../operations/upgrades.md#one-registry-product);
retirement does not purge private content or widen reviewer access.

A [publication to members](shareholder-publications.md#every-read-is-audited-and-an-unrecorded-read-is-refused)
follows the same read-audit rule for a document a member reads rather than a
reviewer, except that its read records are deleted with it when it is
[purged](shareholder-publications.md#retention).

Company documents carry no read audit: not for the owner, not for staff in
admin, and not for an investor opening an offering's documents. Those are the
offer information the issuer chose to give every eligible investor, rather than
a personal record such as a payslip or a member's own statement.

A [company pack](company-pack.md#documents) carries a company's documents,
the evidence copies its register changes retained, its publications' documents
and its payment records' remittance evidence, all stored under `companies/`. No file stored under `users/` or `documents/` leaves in a pack.

Correction requests retain a private copy of the reviewed authority document,
with its content and company binding. During the synthetic experiment those
requests and files have no automatic expiry. The database refuses ordinary row
deletion; the existing orphan sweep removes only unreferenced copies. See the
[correction workflow](../operations/register-foundation.md#reviewed-compensating-corrections).

## Validation and extraction

Every upload is byte-bounded, scanned by ClamAV and decoded as PDF/PNG/JPEG before
permanent storage. Actual type must match MIME and extension. Encrypted/repaired
PDFs, truncated or animated images and over-budget content are refused. Original
evidence bytes are preserved; size and MIME derive from checked bytes.

ASGI bounds request bytes and body arrival time before spooling. WSGI bounds size
and reads but needs a server/proxy timeout for blocked sockets. Authenticated
attempts and chunks consume shared Redis quotas before scanning/saving; CSRF
parsing bytes are charged after successful authentication. Pre-authentication
refusals retain ingress limits without claiming a user quota was charged.
Quota denial returns 429; scanner/cache failure returns 503.

Extraction rereads and rescans stored bytes, renders the first page inside a
resource-limited child and sends a bounded PNG to the configured local model.
The child shares the service OS identity and is not a security sandbox. Failure
preserves the original and records a failed extraction. These controls do not
retroactively certify legacy files.

Next: [upload configuration](../operations/uploads.md),
[storage migration recovery](../operations/recovery.md#private-file-migrations)
and [legal retention positions](../legal/positions.md).
