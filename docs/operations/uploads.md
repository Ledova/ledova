# Upload storage and limits

[Operations](README.md) · [Documentation](../README.md)

Configure private storage, retention clocks, Redis quotas and the malware scanner for uploads and extraction.

## Data retention

| Variable | Default | Required |
| --- | --- | --- |
| `CLASSIFICATION_EVIDENCE_RETENTION_DAYS` | `2557` | No; `0` retains indefinitely and purges nothing |
| `UNATTACHED_DOCUMENT_RETENTION_DAYS` | `30` | No; lifetime of an unattached payslip from upload; `0` retains indefinitely |
| `FORMER_MEMBER_RETENTION_DAYS` | `2557` | No; a value **below** 2557 refuses the fold and the purge |

Days an investor classification's evidence file is kept, measured from
`reviewed_at` for a rejected, revoked or withdrawn claim and from `expires_at`
for a verified one. 2557 days is seven calendar years including two leap days;
the reading is unadvised ([legal position 3](../legal/positions.md#3-the-evidence-retention-period)).
`0` retains indefinitely: the deadline stays unset and nothing is deleted.
Attached payslips inherit this claim clock; unattached uploads use their
separate, shorter lifetime. Neither setting changes an eligibility decision.

`FORMER_MEMBER_RETENTION_DAYS` behaves the opposite way: `retention_cutoff`
raises `ImproperlyConfigured` below 2557 days, so the floor cannot be configured
away and `0` is not a valid value. It implements the accepted seven-year
assumption for s169(3), which is unadvised
([legal position 1](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)).
This is the one statement of what the daily purge removes and leaves; the
[register runbook](register-foundation.md#company-register-commands) and the
plan guides link here (owner decisions, 21 and 22 September and 5 October 2026):

- The purge measures from the cessation date, and a later full-history fold
  cannot recreate what it removed.
- The same clock and job cover register export records, measured from the
  export; imported former members, from their date ceased; and a member's
  recorded particulars, from the last date the member held shares in the
  company.
- It removes nothing else of a register opening, import, correction, wallet
  link, particulars change, grant or direct transfer. The proposal's copies of
  its register, ASIC, authority, supporting, terms, acceptance and instrument
  documents, its decisions, captured boundaries and identity snapshots, and the
  company's evidence uploads of kind `share_register`, `asic_extract`,
  `authority` or `supporting`, including those no proposal used, are evidence
  with no automatic expiry during the synthetic experiment. Ordinary deletion
  of them is blocked; only copies left by a rolled-back or interrupted
  preparation fall under the 24-hour orphan sweep.
- Production retention is decided before any real data. Account and company
  deletion still respect the protected register relations, and classification
  evidence, former-member retention and export records keep their independent
  policies.

[Publications to members](../architecture/shareholder-publications.md#retention)
share the same floor and setting, measured from the publication, and a
[second daily job](jobs.md#schedule) purges them.

## Media storage

| Variable | Default | Required |
| --- | --- | --- |
| `STORAGE_BACKEND` | `local` | No; `local`, `s3` or `gcs`, and forced to `local` whenever `DEBUG` is on |
| `AWS_STORAGE_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=s3` |
| `AWS_S3_REGION_NAME` | `ap-southeast-2` | No |
| `GS_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=gcs` |

Uploaded evidence uses private storage and authenticated streaming endpoints.
No upload is served by `/media/`, including in debug mode. Local evidence lives
under `PRIVATE_MEDIA_ROOT`, which also works with `DEBUG=false`; cloud evidence
uses private S3/GCS objects. Authenticated file reads keep the same owner and
staff permissions in both entrypoints. See the
[storage and retention architecture](../architecture/files-and-retention.md).

## Repairing stray uploads and checking MIME types

`python manage.py reconcile_private_media` repairs local uploads whose bytes sit
under `MEDIA_ROOT` instead of `PRIVATE_MEDIA_ROOT`. For every private file
field it moves each stray file back under `PRIVATE_MEDIA_ROOT`, removes the
public copy only when a private copy with the same bytes already exists, and
leaves alone, and reports, a pair whose bytes differ. `--check` reports without
moving and exits non-zero when it finds a stray or a conflict. With a
`STORAGE_BACKEND` other than `local` it does nothing.

When exporting records from an older database, check stored MIME values against
the allowlist in `backend/shared/uploads.py`: PDF, PNG and JPEG. The values
live on `documents.mime_type`, `companies_companydocument.mime_type` and
`users_investorclassification.evidence_mime_type`:

```sql
SELECT 'documents' AS source, mime_type, COUNT(*) AS rows
FROM documents GROUP BY mime_type
UNION ALL
SELECT 'companies_companydocument', mime_type, COUNT(*)
FROM companies_companydocument GROUP BY mime_type
UNION ALL
SELECT 'users_investorclassification', evidence_mime_type, COUNT(*)
FROM users_investorclassification GROUP BY evidence_mime_type
ORDER BY source, rows DESC;
```

A blank value is an allowed stored value on documents and classification
evidence, not on company documents, and is served as
`application/octet-stream`. A value outside the allowlist stays an attachment;
normalise it explicitly rather than weakening the serving rules.

## Upload validation and resource limits

Uploads require Redis and a running ClamAV daemon with current signatures.
Compose adds `clamav/clamav:1.5.4`, a 4 GiB memory limit, two CPUs and a private
TCP endpoint with no published host port. Backend and worker startup require the
scanner service to start, but do not wait for signature loading or health. Other
application routes remain available; uploads return 503 until scanning succeeds.
The health probe uses `clamdscan --ping=1 --config-file=/etc/clamav/clamd.conf`.
Freshclam updates the dedicated `clamav_data` volume. The checked-in clamd config
rejects over-budget/encrypted content, caps scan time at 5 seconds and refuses
startup with databases older than seven days. A new volume is filled from the
image's own signatures, which can already be older than that, so local Compose
runs one Freshclam update before starting the daemon; offline, it starts without
one. Monitor health and Freshclam update failures; startup freshness is not a
continuous freshness guarantee.

ClamAV's [INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)
has no authentication or transport encryption. Keep it on a trusted private
network accessible only to application services. Follow the
[official Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html)
for signature storage and resource provisioning. An exact clean verdict is
mandatory; connection errors, malformed replies and unavailable scanning fail
closed. The client runs in a child with a parent deadline that also covers DNS
resolution. Detected files return 400 and are never saved to permanent storage;
there is no retained quarantine or bypass switch. Malware scanning cannot prove
arbitrary content harmless.

Defaults below are integer environment settings shared by backend and worker.
Each decoder or scanner child refuses to run unless its address-space, CPU and
file-size limits are positive integers, so a setting below 1 fails every upload
instead of lifting a limit; it turns core dumps off and sets the limits before
reading the upload. On Linux every limit applies. When the kernel refuses to
lower the address-space limit, the child runs without it and the parent logs
`Upload workers run without RLIMIT_AS, which this platform refuses to set` once
per process. macOS refuses any address-space limit below what a process has
already mapped, so there the children run without the
`UPLOAD_PROCESS_MEMORY_BYTES` cap, and its CPU limit does not stop a child that
spends its time in system calls; the parent's wall deadline applies on every
platform. Resource limits contain work; they are not a security sandbox or an
aggregate concurrency limit.

| Variable | Default | Bound |
| --- | --- | --- |
| `UPLOAD_MAX_BYTES` | `10485760` | Actual bytes per file (10 MiB) |
| `UPLOAD_MAX_REQUEST_BYTES` | file limit + `65536` | Whole upload request before multipart buffering |
| `UPLOAD_BODY_SECONDS` | `30` | ASGI body arrival deadline |
| `UPLOAD_MAX_PDF_PAGES` | `100` | Pages inspected before any rendering |
| `UPLOAD_MAX_SOURCE_PIXELS` | `16000000` | Image/embedded-image pixels or PDF page pixels at 2x scale |
| `UPLOAD_MAX_DECODED_BYTES` | `67108864` | Four bytes/pixel estimate per image/page and sum of unique embedded images on a page |
| `UPLOAD_RENDER_MAX_SIDE` | `1600` | Longest rendered PNG side |
| `UPLOAD_RENDER_MAX_BYTES` | `8388608` | Rendered PNG bytes |
| `UPLOAD_PROCESS_MEMORY_BYTES` | `536870912` | Decoder and scanner-client address space |
| `UPLOAD_PROCESS_CPU_SECONDS` | `5` | Child CPU time |
| `UPLOAD_PROCESS_WALL_SECONDS` | `10` | Decoder child wall deadline |
| `UPLOAD_SCANNER_HOST` | `clamav` | Private daemon hostname; Compose sets this explicitly |
| `UPLOAD_SCANNER_PORT` | `3310` | Private daemon TCP port |
| `UPLOAD_SCANNER_SECONDS` | `10` | Scanner-client child wall deadline |
| `UPLOAD_REQUESTS_PER_HOUR` | `20` | Authenticated create attempts per rolling hour/user across all upload routes |
| `UPLOAD_BYTES_PER_HOUR` | `52428800` | Actual file bytes per rolling hour/user (50 MiB) |

Accepted and rejected authenticated attempts consume quota; quota rejection does
not admit more work. Redis Lua uses the server clock and reserves count/bytes
atomically across processes. File chunks are charged before scanning; files
parsed during successful cookie CSRF authentication are charged before validation.
Authentication/CSRF failures and files refused while authentication is still
parsing have no completed user identity to charge, but have the same body/file
caps. A missing atomic cache implementation or unavailable Redis returns 503;
quota denial returns 429 with `Retry-After`. Worker restarts retain quota;
Redis data loss resets it. Only one file is accepted per request.

The entrypoint bounds apply to resolved upload-create routes, including chunked
ASGI bodies and falsely small declared sizes. WSGI cannot interrupt a blocked
socket read: configure the HTTP server/proxy body timeout. Configure proxy/server
body and connection/concurrency limits for both entrypoints, since unauthenticated
clients and many users can each consume a bounded request. Keep the proxy cap at
least the configured request limit if clients should receive the API error body.
Changing file limits also requires aligning `StreamMaxLength`/`MaxFileSize` and
the other scan limits in `backend/.deployment/clamd.conf`; the stricter bound wins.

The ordinary suite stubs the scanner and cache; one test holds that an infected
or unscannable upload is refused. No CI job runs a real daemon, so scanner
health must be monitored on the instance.
