# Shareholder publications

[Architecture](README.md) · [Register of members](register.md) · [Uploaded files](files-and-retention.md)

A publication is one record of one thing a company publishes to its members. It
carries the document itself, the company's written instruction and the authority
for it, and the roll of members it was addressed to, frozen when it was made.
[publications.py](../../backend/shareholders/services/publications.py) makes one
and serves it; the roll is built by
[roll.py](../../backend/shareholders/services/roll.py) from the stored register
and reads no chain. Members read what was published to them through
[the publications route](#the-members-route), in the dashboard and in the mobile
app.

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

## The company and the share class are frozen too

The publication stores the company's name and the share class's name and symbol
as they were when it was made, beside the roll. Two reasons, and the second is
the load-bearing one.

A publication is a frozen record, so the member who reopens a statement in June
should read the name it carried in March, exactly as the roll carries each
member's name as at the record date.

And the company and the share class are not reliably readable by the member.
`tokens_sharetoken`'s read term is the issuer's own companies or a class on the
market, which is `status = 'deployed'`; `companies_company`'s is ownership,
the directory opt-in, or having a class on the market. The insert guard requires
a deployed class with a contract address, so both rows are readable at the
moment of publishing — but **a pause moves the class out of both terms.** A
serializer that reached the names through `select_related` would then drop the
publication itself from the member's listing, because Django joins a
non-nullable foreign key with an INNER JOIN, and a row the policy hides deletes
the row that points at it. That is the failure the `companies_company` entry in
[policies.py](../../backend/shared/db/policies.py) was measured against, and the
reason it carries a market term at all. Storing the three names avoids the join
instead of widening a policy: widening one is not open to us here, because the
roll's own policy reads `companies_company` through the visible-companies
helper, and a term on `companies_company` that read the roll back would be a
recursion PostgreSQL refuses.

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

A member and a company owner reach theirs through the same route; staff have no
route at all, because there is no client for one and admin already serves them.

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

## The member's route

[`PublicationViewSet`](../../backend/shareholders/views/publication.py) is the
whole investor surface, mounted at `/api/v1/publications/`:

| Route | Answers |
| --- | --- |
| `GET /api/v1/publications/` | What was published to this principal, newest first |
| `GET /api/v1/publications/{uuid}/file/` | The stored document, as an attachment |

There is no retrieve route: the listing carries everything a member is shown,
and a route with no client would be a surface nobody asked for.

The listing is scoped by the database alone — the view names `Publication` as
its `scoped_model` and adds no owner filter, so the same two-sided policy that
admits a member and the company that published governs the page. The member's
own holding is a correlated subquery on the roll rather than a join, so a
company owner, who names no roll row, reads its own publications with `shares`
null instead of losing them.

The file route calls `read_publication` rather than the base's `get_object`,
because resolving the row and writing the audit are one act: the service reads
through the policy-scoped connection, records the `PublicationRead` on the
operator connection, and refuses with 503 `publication_read_unrecorded` if it
cannot. A foreign or non-existent uuid answers the same 404 with the same body.

Both clients read it through `@ledova/shared`: `getPublications` for the
listing, `openPublication` for a browser blob and `downloadPublication` for the
bytes the mobile app writes to one private cache copy and hands to the system
share sheet, the way a company document is opened today.

## Every publication is announced

When the roll commits, `tell_the_members` is deferred once for the publication.
It reads the roll on the operator connection and defers one ordinary
notification for each member with an account — `notification_type` `general`,
so there is no new preference switch to forget to honour (owner decision,
23 September 2026). A member the register cannot name is on the roll and is told
nothing, because there is no account to tell.

The notice carries no holding and no document: its data names the publication
and its kind, and both clients turn `type: "publication"` into a jump to the
publications page. The member's own read then goes through the route above,
which re-resolves the publication under the policies and audits the delivery.

## Not built yet

Resolutions, ballots and tallies, and distributions and their entitlements, are
later slices of [#649](https://github.com/Ledova/ledova/issues/649) and add
columns and an event chain to this spine rather than new tables for the roll.

Next: [publishing to members](../operations/publications.md),
[scheduled jobs](../operations/jobs.md) and
[tenancy](tenancy.md).
