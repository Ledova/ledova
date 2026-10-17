# Jobs and storage

[Operations](README.md) · [Documentation](../README.md)

How to run the background worker, what it runs and when, how long job records are kept, and how to
operate private file storage, malware scanning and upload limits. It is for whoever runs an
instance. All clock times are UTC. The storage and retention variables are listed under
[configuration](configuration.md#storage-uploads-and-retention).

- [Running a worker](#running-a-worker)
- [Schedule](#schedule)
- [Job records](#job-records)
- [Private storage](#private-storage)
- [Malware scanning](#malware-scanning)
- [Upload limits](#upload-limits)

## Running a worker

Procrastinate runs on PostgreSQL. Start a worker with
`python manage.py procrastinate worker --queues=default,builtin`, which is what the Compose `worker`
service runs and `make worker` runs from `backend/`. `ledova_backend/worker_entrypoint.py` is an
alternative entrypoint that also serves a health endpoint on `PORT` (default 8080) for platforms
that require one. Senders defer jobs rather than doing the work in the request, so notifications,
recovery and every task below wait until a worker is running.

## Schedule

| Schedule | Task |
| --- | --- |
| every minute | `expire_unclaimed_matches`, `place_held_orders` |
| every 5 min | `check_pending_token_deployments`, `check_pending_swap_approvals`, `check_pending_pause_changes`, `check_pending_nav_updates`, `check_executing_issuance_requests`, `resolve_executing_swaps`, `reconcile_subscriptions`, `check_pending_transactions`, `check_all_pending_transactions`, `recover_wallet_submissions`, `recover_swap_approval_submissions`, `observe_wallet_chains`, `recover_mint_requests`, `recover_whitelist_changes`, `refresh_whitelist_approvals`, `recover_capital_increases`, `close_resolutions_past_their_window` |
| every 10 min | `sync_all_assets`, `sync_exchange_rates` |
| every 30 min | `sync_all_entries` |
| hourly, on the hour | `sync_all_wallets`, `run_batch_monitoring` |
| hourly, at :15 | `purge_signing_challenges` |
| every 6 hours, at :20 | `fold_every_share_class` |
| every 6 hours, at :50 | `reconcile_every_register` |
| daily 03:00 | `expire_unpaid_subscriptions`, `purge_classification_evidence` |
| daily 03:15 | `purge_document_evidence` |
| daily 03:30 | `sweep_private_uploads` |
| daily 03:40 | `purge_former_members_past_the_clock` |
| daily 03:50 | `purge_publications_past_the_clock` |
| daily 04:00 | `check_periodic_reviews` |
| daily 04:30 | `remove_old_jobs` |

Some deferred jobs also retry on their own schedule: `refresh_whitelist_targets` retries a deleted
wallet's removal every five minutes with no attempt ceiling. What each recovery task does, and the
admin action that goes with it, is in [recovery](recovery.md).

## Job records

`remove_old_jobs` deletes finished job records, with their events, through Procrastinate's job
manager, as Procrastinate's own builtin `remove_old_jobs` does: a succeeded job seven days after it
finished, and a failed, cancelled or aborted job thirty days after. A job still to do or running is
never removed, however old, so a job that keeps retrying stays until it finishes.

Staff retry a failed job from the admin's Procrastinate jobs page with Retry Job, which needs the
record. A failed `reconcile_every_register` is one to look at: it is the signal that some share
class could not be reconciled
([reconciling a register](recovery.md#reconciling-a-register-on-demand)). To keep
older records for an investigation or an audit, copy them out of `procrastinate_jobs` and
`procrastinate_events` before the next run.

## Private storage

Uploaded evidence uses private storage and authenticated streaming endpoints; no upload is served
by `/media/`, in either debug mode. Local evidence lives under `PRIVATE_MEDIA_ROOT`, which also
works with `DEBUG=false`; cloud evidence uses private S3 or GCS objects. Private storage is backed
up and restored with the database. How files are served, who may read them and when they are
deleted is in [uploaded files](../engineering/security.md#private-files).

### Previewing the upload sweep

`sweep_private_uploads` deletes private files under `companies/` and `documents/` that no row
references and that have not changed for 24 hours
([why](../engineering/security.md#deletion-and-retention)). Each run logs how many
files it found, deleted and failed to delete, and a file it failed to delete is tried again on the
next run.

To see what it would delete now, run `python manage.py sweep_orphaned_files --dry-run` from
`backend/`. The command runs the same sweep, prints each file it would delete and deletes nothing.
What it prints matches what the job would delete only when it runs with the worker's environment:
the same database roles, `STORAGE_BACKEND` and bucket. Without `--dry-run` it runs the sweep
immediately.

### Repairing stray uploads

`python manage.py reconcile_private_media` repairs local uploads whose bytes sit under `MEDIA_ROOT`
instead of `PRIVATE_MEDIA_ROOT`. For every private file field it moves each stray file back under
`PRIVATE_MEDIA_ROOT`, removes the public copy only when a private copy with the same bytes already
exists, and leaves alone, and reports, a pair whose bytes differ. `--check` reports without moving
and exits non-zero when it finds a stray or a conflict. With a `STORAGE_BACKEND` other than `local`
it does nothing.

### Checking stored MIME types

Before exporting records from an older database, check the stored MIME values against the
allowlist in `backend/shared/uploads.py`: PDF, PNG and JPEG. The three original upload tables are
checked by:

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

Authority request documents, register evidence, publications and publication events carry their
own `mime_type` or `evidence_mime_type` columns and need the same check. A blank value is allowed
on documents and classification evidence, not on company documents, and is served as
`application/octet-stream`. A value outside the allowlist stays an attachment; normalise it
explicitly rather than weakening the serving rules.

## Malware scanning

Uploads need Redis and a running ClamAV daemon with current signatures. Compose runs
`clamav/clamav:1.5.4` with a 4 GiB memory limit, two CPUs and a private TCP endpoint with no
published host port. Backend and worker startup wait for the scanner service to start, not for
signature loading or health: other routes stay available and uploads return 503 until scanning
succeeds. The health probe is `clamdscan --ping=1 --config-file=/etc/clamav/clamd.conf`.

Freshclam updates the dedicated `clamav_data` volume. The checked-in `backend/.deployment/clamd.conf`
rejects over-budget and encrypted content, caps scan time at 5 seconds and refuses to start with
signatures older than seven days. A new volume is filled from the image's own signatures, which can
already be older than that, so local Compose runs one Freshclam update before starting the daemon;
offline, it starts without one. Monitor health and Freshclam update failures: startup freshness is
not a continuous freshness guarantee. No CI job runs a real daemon, so scanner health must be
watched on the instance.

ClamAV's [INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html) has no
authentication or transport encryption. Keep it on a trusted private network reachable only by the
application services, and follow the
[official Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html) for signature
storage and resource provisioning. Only an exact clean verdict is accepted; connection errors,
malformed replies and unavailable scanning fail closed, and a detected file is refused with 400 and
never saved. There is no quarantine or bypass switch.

## Upload limits

The limits are integer environment settings shared by the backend and worker. Each decoder or
scanner child refuses to run unless its address-space, CPU and file-size limits are positive
integers, so a setting below 1 fails every upload instead of lifting a limit.

| Variable | Default | Bound |
| --- | --- | --- |
| `UPLOAD_MAX_BYTES` | `10485760` | Actual bytes per file (10 MiB) |
| `UPLOAD_MAX_REQUEST_BYTES` | file limit + `65536` | Whole upload request before multipart buffering |
| `UPLOAD_BODY_SECONDS` | `30` | ASGI body arrival deadline |
| `UPLOAD_MAX_PDF_PAGES` | `100` | Pages inspected before any rendering |
| `UPLOAD_MAX_SOURCE_PIXELS` | `16000000` | Image or embedded-image pixels, or PDF page pixels at 2x scale |
| `UPLOAD_MAX_DECODED_BYTES` | `67108864` | Four bytes per pixel per image or page, and the sum of unique embedded images on a page |
| `UPLOAD_RENDER_MAX_SIDE` | `1600` | Longest rendered PNG side |
| `UPLOAD_RENDER_MAX_BYTES` | `8388608` | Rendered PNG bytes |
| `UPLOAD_PROCESS_MEMORY_BYTES` | `536870912` | Decoder and scanner-client address space |
| `UPLOAD_PROCESS_CPU_SECONDS` | `5` | Child CPU time |
| `UPLOAD_PROCESS_WALL_SECONDS` | `10` | Decoder child wall deadline |
| `UPLOAD_SCANNER_HOST` | `clamav` | Private daemon hostname; Compose sets it explicitly |
| `UPLOAD_SCANNER_PORT` | `3310` | Private daemon TCP port |
| `UPLOAD_SCANNER_SECONDS` | `10` | Scanner-client child wall deadline |
| `UPLOAD_REQUESTS_PER_HOUR` | `20` | Authenticated create attempts per rolling hour per user, across all upload routes |
| `UPLOAD_BYTES_PER_HOUR` | `52428800` | Actual file bytes per rolling hour per user (50 MiB) |

On Linux every limit applies. Where the kernel refuses to lower the address-space limit, the child
runs without it and the parent logs
`Upload workers run without RLIMIT_AS, which this platform refuses to set` once per process. macOS
refuses any address-space limit below what a process has already mapped, so there the children run
without the `UPLOAD_PROCESS_MEMORY_BYTES` cap, and its CPU limit does not stop a child that spends
its time in system calls; the parent's wall deadline applies on every platform. On Linux the warning
is a fault to investigate. Resource limits contain work; they are not a security sandbox or an
aggregate concurrency limit.

The two hourly quotas reserve count and bytes atomically in Redis, using its clock; accepted and
rejected authenticated attempts both consume quota, and a denial returns 429 with `Retry-After`.
Unavailable Redis returns 503. Worker restarts keep the quota; Redis data loss resets it. Only one
file is accepted per request. How the quotas are charged during authentication is in
[validation and extraction](../engineering/security.md#upload-validation).

The entrypoint bounds apply to resolved upload-create routes, including chunked ASGI bodies and
falsely small declared sizes. WSGI cannot interrupt a blocked socket read, so configure the HTTP
server or proxy body timeout. Configure proxy or server body, connection and concurrency limits for
both entrypoints, since unauthenticated clients and many users can each consume a bounded request,
and keep the proxy's cap at least the configured request limit if clients should receive the API's
error body. Changing the file limits also means aligning `StreamMaxLength`, `MaxFileSize` and the
other scan limits in `backend/.deployment/clamd.conf`; the stricter bound wins.

Next: [recovery](recovery.md), [configuration](configuration.md)
or [uploaded files](../engineering/security.md#private-files).
