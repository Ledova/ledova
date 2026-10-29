# ledova.io rebuild, 30 October 2026

[Operations](../README.md) · [Documentation](../../README.md)

The dated record of the owner-directed fresh-database rebuild and release of the private test
deployment at ledova.io, under [#1431](https://github.com/Ledova/ledova/issues/1431). It followed
[rebuild a database](../README.md#rebuild-a-database); the direction is in the
[decisions log](../../decisions.md#ledovaio-rebuild-of-30-october-2026). The full working record is
on the issue.

## Outcome

ledova.io serves main `90274b07` on a fresh database. #1421 had replaced every project migration
with fresh initial ones, so the earlier database could not take the release in place. The
inventory found only test data: 9 sign-ins, 4 draft companies, none activated, and 21 private
files. Nobody had signed in since 12 October. At the owner's choice, the new database kept no
earlier records, so it has no accounts, no staff account and an empty operator record until they
are created.

## How it ran

- **Backup:** both databases, the roles, both media volumes, the configuration and the running
  image references, checksummed on the host and copied off it.
- **Rehearsal:** on a throwaway PostgreSQL 16 and Redis pair on an internal Docker network, with no
  worker running and no outside access. The backup restored with the expected counts. The new
  database migrated, passed the system, role and catalogue checks and took the reference seeds. The
  backend suite passed on the release image.
- **Cutover:** a new database in the same cluster was migrated, checked and seeded while the old
  release still served. The new release then started with new media volumes, a separate Redis
  index and a new secret key, which also signs JWTs, so nothing issued before the rebuild
  authenticates.
- **First switch, rolled back:** the dashboard image's files kept owner-only modes, so its web
  server refused them and the health check failed. The previous release came back from the
  untouched configuration. The app was unavailable for about 3¼ minutes, and the public website
  stayed up. The image was rebuilt with readable files.
- **Second switch:** 23 seconds.
- **Checks after:** the public pages, health and the refusal of anonymous operator access answered
  as expected, and the served dashboard matched the build. The services were healthy with no
  restarts, scheduled jobs ran, and the migrations were complete.

## Afterwards

At the owner's request the host keeps only what runs. The old databases and volumes, earlier
release folders, unused images and both backups, including the off-host copy, were deleted. Main
later gained #1433, a website-only change that is not deployed. No signer, chain or funds
activation took place, email is still saved to files, and the physical-device acceptance in #624
remains.
