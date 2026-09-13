# Private-storage migration procedures

[Reference](README.md) · [Recovery](../operations/recovery.md#private-file-migrations)

Use these procedures for a synthetic database carried from an older release.
Preserve private storage alongside database backups; schema rollback cannot
restore deleted evidence. Test the applicable migration on a restored copy first.

## Moving existing files

Moving a field onto private storage follows
`companies/migrations/0006_company_document_private_storage.py`:

1. `RunPython(move_uploads(..., to_private=True), move_uploads(..., to_private=False))`
     relocates existing bytes between `MEDIA_ROOT` and `PRIVATE_MEDIA_ROOT`,
     skipping a row whose file is already missing from disk.
2. `SeparateDatabaseAndState(state_operations=[AlterField(...)])` carries the
     storage and `max_length` change in migration state only.
3. `RunPython(widen_char_column(...), noop)` widens the column on PostgreSQL.

The helpers are in `backend/shared/utils/migrations.py`. **A file move is not
covered by the DDL transaction, so it undoes itself.** `_relocate` records
every file it has moved and, when a move raises, puts them all back before
re-raising, so a reverse that dies halfway leaves the whole corpus where it
started rather than half of it publicly readable under `MEDIA_ROOT` with the
ledger still claiming the migration applied — unrecoverable by normal operator
action, because Django will not re-run an operation belonging to an applied
migration. Operations reverse back to front, putting the byte move last, so
nothing runs after it that could roll the database back out from under a
succeeded move. If the put-back itself fails, the migration raises
`UploadRelocationError` naming every file it could not return, and
`manage.py reconcile_private_media` repairs the corpus: over every `FileField`
bound to `PrivateMediaStorage` it moves stored keys whose bytes sit under
`MEDIA_ROOT` back under `PRIVATE_MEDIA_ROOT`, drops a public copy that
duplicates a private one byte for byte, and refuses to guess when the two
differ; `--check` reports without moving and exits non-zero, so it also
audits. The widening reverses to a no-op rather than to `AlterField`'s
auto-derived narrowing, which would raise
`value too long for type character varying(100)` on any document uploaded
after the migration — the generated keys run to 118 characters; a rollback
leaves the column wider than the state claims, which costs nothing and strands
no bytes. `backend/shared/tests/test_private_storage_migrations.py`
round-trips both migrations with real bytes, a row whose file is missing, and
a key generated after the widening, and drives a reverse that fails partway
through the byte move in both the recoverable and the unrecoverable shape.

## Check historical MIME types

Before serving a database predating the upload allowlist, inspect its write history:

```sql
SELECT 'documents' AS source, mime_type, COUNT(*) AS rows,
       MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
FROM documents GROUP BY mime_type
UNION ALL
SELECT 'companies_companydocument', mime_type, COUNT(*),
       MIN(created_at), MAX(created_at)
FROM companies_companydocument GROUP BY mime_type
UNION ALL
SELECT 'users_investorclassification', evidence_mime_type, COUNT(*),
       MIN(created_at), MAX(created_at)
FROM users_investorclassification GROUP BY evidence_mime_type
ORDER BY source, rows DESC;
```

The current upload allowlist is PDF, PNG and JPEG. Include blank values in the
review: they are allowed stored values on documents/classification metadata, but
not company-document MIME metadata. Values continuing into current writes require
finding the writer; old values need explicit normalization. Out-of-allowlist files
remain attachments, and a blank type falls back to `application/octet-stream`.
Do not weaken serving rules for historical rows.
