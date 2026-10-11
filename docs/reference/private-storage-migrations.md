# Private-storage migration procedures

[Reference](README.md) · [Recovery](../operations/recovery.md#private-file-migrations)

Preserve private storage alongside database backups; a schema restore cannot
restore deleted evidence. The [11 October fresh-database plan](../operations/upgrades.md#fresh-database-rebuild)
requires owner approval before any ledova.io backup, export or rebuild.

## Moving existing files

Fresh migrations create the current private-file fields. There is no old-database
baseline adoption or automatic file relocation. An agreed record export must
retain referenced files, keys and fingerprints together. Earlier relocation
migrations remain in Git history.

`manage.py reconcile_private_media` repairs stray local uploads. For every
private `FileField`, it moves stored keys whose bytes sit under `MEDIA_ROOT`
back under `PRIVATE_MEDIA_ROOT`, removes a public duplicate only when its bytes
match, and refuses to guess when the two copies differ. `--check` reports without
moving and exits non-zero when it finds a stray or conflict. The minimum upload test covers scanner refusal; it does not certify a complete
private-media corpus migration or cloud lifecycle.

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
