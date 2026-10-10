# Private-storage migration procedures

[Reference](README.md) · [Recovery](../operations/recovery.md#private-file-migrations)

Preserve private storage alongside database backups; a schema restore cannot
restore deleted evidence. Test release adoption on a restored copy first and
follow the [baseline upgrade procedure](../operations/upgrades.md#adopting-the-migration-baseline).

## Moving existing files

The baseline starts with private file fields and their widened columns. An older
database must reach the complete pre-baseline release first; its file relocation
migrations and tests remain in Git history. Baseline adoption moves no files and
does not narrow stored keys.

`manage.py reconcile_private_media` repairs stray local uploads. For every
private `FileField`, it moves stored keys whose bytes sit under `MEDIA_ROOT`
back under `PRIVATE_MEDIA_ROOT`, removes a public duplicate only when its bytes
match, and refuses to guess when the two copies differ. `--check` reports without
moving and exits non-zero when it finds a stray or conflict. Current private-media
corpus, reconciliation and cloud-lifecycle tests retain the runtime coverage.

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
finding the writer; old values need explicit normalisation. Out-of-allowlist files
remain attachments, and a blank type falls back to `application/octet-stream`.
Do not weaken serving rules for historical rows.
