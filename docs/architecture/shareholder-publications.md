# Shareholder publications

[Architecture](README.md) · [Register of members](register.md) · [Uploaded files](files-and-retention.md)

A publication is one record of one thing a company publishes to its members. It
carries the document itself, the company's written instruction and the authority
for it, and the roll of members it was addressed to, frozen when it was made.
[publications.py](../../backend/shareholders/services/publications.py) makes one
and serves it; the roll is built by
[roll.py](../../backend/shareholders/services/roll.py) from the stored register
and reads no chain.

Ledova staff publish on the company's written instruction, as inspection copies,
certificates and notice figures are prepared today. The
[runbook](../operations/publications.md) is the procedure. Company self-service
can be added later without changing anything a member sees.

## One record for everything a company publishes

The first two kinds are the annual holding statement and the meeting notice. A
publication's `kind` is an open list, and the columns every kind needs — the
company, the share class, the record date, the instruction, the authority and
the snapshot head — sit on the row itself, so a resolution or a distribution
joins the same table rather than starting another one. The per-kind constraint
that requires stored bytes and a digest names the document kinds it applies to,
so a kind that carries no file does not have to rewrite it.

A publication is frozen: PostgreSQL refuses every update to it and to its roll,
and the only deletion anyone may perform is the retention purge.

## Stored bytes, not a regenerated document

The register's own outputs keep a SHA-256 of bytes they hand to a staff browser
and regenerate them from the replayable event chain. A publication cannot work
that way, because the member has to be able to reopen in June what they read in
March, and a register that has moved on would produce different bytes. So the
bytes are stored in private storage through the ordinary upload pipeline, and
the SHA-256 recorded beside them is the digest of what was stored.

The company's authority is a verified company document of the same company, and
the publication copies that document's `verified_fingerprint`. The database
refuses a publication whose authority is not a current, content-bound
verification of a document of that company; changing the document clears its
verification, so the authority cannot silently drift from what was reviewed.

## The frozen roll

When the publication is made, one transaction locks the share class's register,
replays every entry effective on or before the record date, and writes one row
for each member holding shares then. Each row carries the register member, the
resolved account, the name as at that moment, the holder type, where the
identity came from, and the shares held. The number of rows and a SHA-256 over
their canonical form are recorded on the publication, so a roll that no longer
matches what was published can be reported rather than assumed.

Identity is resolved once, by the register's own resolution, and the four holder
types are carried faithfully. A member the register cannot name — ambiguous,
treasury or unidentified — stays on the roll with no account, for the company's
records, and has no online surface, exactly as a certificate is refused for a
member who cannot be named by a name and a residential address.

**Identity is never resolved by a wallet address.** `Wallet` is unique per
(account, chain, address), so two accounts can each hold a row for one address,
and a policy that joined a member's wallet address to an account would hand one
member's statement to another. The resolution runs in Python when the roll is
frozen and stores the account it found, and the policy reads that column alone.

## Who may read a publication

| Reader | Sees |
| --- | --- |
| A member | The publications addressed to them, and their own roll row |
| The company that published | Its own publications and their whole roll |
| Ledova staff | Every publication, through admin, on the operator connection |

Both tables are read-only to the application role: every write term is `false`,
and only the operator writes them. The publication's read term is the company
that made it or a roll row naming this principal; the roll row's own term is the
principal it names or the company that published, on the row's own columns, so
the two policies do not read each other in a circle. The roll row carries its
publication's company for that reason, and the database refuses a row whose
company differs from its publication's.

## Every read is audited, and an unrecorded read is refused

Each delivery writes an append-only `PublicationRead` on the operator
connection, naming the reader, the publication, the roll row where there is one,
and whether the reader was the member, the company or staff. The table is
operator-only, has no admin mutation path, and carries no name, holding or file
content. **A read that cannot be recorded refuses the delivery** rather than
serving the file, which is the rule
[document reads](files-and-retention.md#deletion-and-retention) already follow.

## Retention

A publication, its roll and its read records are kept for the register's own
seven-year floor and purged together by a daily job. They share
`FORMER_MEMBER_RETENTION_DAYS` and its `ImproperlyConfigured` refusal below
2,557 days with the register's outputs, so the floor cannot be configured away
and one clock governs both. The purge is the only deletion; removing the row
deletes its stored bytes with it, through the ordinary private-file lifecycle
receiver, under the swept `companies/` prefix.

## Not built yet

A member's surface is the delivery service and nothing else: no route, no
client page and no notification fan-out exist yet. Resolutions, ballots and
tallies, and distributions and their entitlements, are later slices of
[#649](https://github.com/Ledova/ledova/issues/649) and add columns and an event
chain to this spine rather than new tables for the roll.

Next: [publishing to members](../operations/publications.md),
[scheduled jobs](../operations/jobs.md) and
[tenancy](tenancy.md).
