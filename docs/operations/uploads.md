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
for a verified one. 2557 days is seven calendar years including two leap days,
chosen because the Corporations Act's financial-records obligation and the
AML/CTF customer-identification obligation both land there. **That reading was
made without advice** — see [legal position 3](../legal/positions.md#3-the-evidence-retention-period). Set `0` to retain
indefinitely: the deadline stays unset and nothing is deleted. Attached payslips
inherit this same claim clock; unattached uploads use their separate, shorter
lifetime. Neither setting changes an eligibility decision.

`FORMER_MEMBER_RETENTION_DAYS` is independent of it and behaves the opposite
way: `retention_cutoff` raises `ImproperlyConfigured` below 2557 days, so the
floor cannot be configured away and `0` is not a valid value. The purge measures
from the cessation date, and a later full-history fold cannot recreate what it
removed. It implements the accepted seven-year assumption for s169(3); the legal
basis is unadvised, and is [legal position 1](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years).
Register export records share this clock, measured from the export; the same
daily job purges both (owner decision, 21 September 2026).

## Media storage

| Variable | Default | Required |
| --- | --- | --- |
| `STORAGE_BACKEND` | `local` | No; `local`, `s3` or `gcs`, and forced to `local` whenever `DEBUG` is on |
| `AWS_STORAGE_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=s3` |
| `AWS_S3_REGION_NAME` | `ap-southeast-2` | No |
| `GS_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=gcs` |

Uploaded evidence uses private storage and authenticated streaming endpoints.
No upload is served by `/media/`, including in debug mode. Local evidence lives
under `PRIVATE_MEDIA_ROOT`; cloud evidence uses private S3/GCS objects. See the
[storage and retention architecture](../architecture/files-and-retention.md).
Local private storage also works with `DEBUG=false`. The obsolete startup guard
that required a public `/media/` route has been removed. Both entrypoints still
require the scoped request connection, and authenticated file reads retain the
same owner and staff permissions.

## Upload validation and resource limits

Uploads require Redis and a running ClamAV daemon with current signatures.
Compose adds `clamav/clamav:1.5.4`, a 4 GiB memory limit, two CPUs and a private
TCP endpoint with no published host port. Backend and worker startup require the
scanner service to start, but do not wait for signature loading or health. Other
application routes remain available; uploads return 503 until scanning succeeds.
The health probe uses `clamdscan --ping=1 --config-file=/etc/clamav/clamd.conf`.
Freshclam updates the dedicated `clamav_data` volume. The checked-in clamd config
rejects over-budget/encrypted content, caps scan time at 5 seconds and refuses
startup with databases older than seven days. Monitor health and Freshclam update
failures; startup freshness is not a continuous freshness guarantee.

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
The decoder uses Linux resource limits; clean synthetic PDF/PNG/JPEG controls run
under the default 512 MiB address-space cap in CI. Resource limits contain work;
they are not a security sandbox or an aggregate concurrency limit.

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
the other scan limits in `backend/clamav/clamd.conf`; the stricter bound wins.

CI runs synthetic clean formats and EICAR through a real daemon and tests Redis
expiry, unavailable connections, fresh processes and concurrent reservations.
Ordinary unit tests stub these external dependencies explicitly; they do not
establish malware detection. Run the integration suites against isolated services:

```sh
UPLOAD_TEST_CLAMAV_HOST=private-scanner \
  python manage.py test shared.tests.clamav_uploads \
  --settings=ledova_backend.settings.test --noinput
UPLOAD_TEST_REDIS_URL=redis://isolated-redis:6379/0 \
  python manage.py test shared.tests.redis_uploads \
  --settings=ledova_backend.settings.test --noinput
```

The suites require real reachable services and fail if they are unavailable;
Redis tests remove only their own unique keys. This change adds the deployment
dependency; it does not roll out a scanner to an already running dev stack.
