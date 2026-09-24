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

The kinds are the annual holding statement, the meeting notice and the
[resolution](#resolutions). A publication's `kind` is an open list, and the
columns every kind needs — the company, the share class, the record date, the
instruction, the authority and the snapshot head — sit on the row itself, so a
resolution and, later, a distribution join the same table rather than starting
another one. The per-kind constraint that requires stored bytes and a digest
names the document kinds it applies to, so a kind that carries no file does not
have to rewrite it. A resolution carries its document too: the resolution and
its explanatory statement.

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
The stored document is opened first and the read recorded second, so a record
always names a file that could be served: a document that cannot be opened
refuses with 503 `publication_unopened` and records nothing.

## Retention

A publication, its roll, its read records and, for a resolution, its event
chain are kept for the register's own seven-year floor and purged together by a
daily job, the chain before the roll it points at. They share
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
| `POST /api/v1/publications/{uuid}/ballot/` | Casts the caller's ballot on a resolution, and answers with its updated row |

There is no retrieve route: the listing carries everything a member is shown,
and a route with no client would be a surface nobody asked for.

The listing is scoped by the database alone — the view names `Publication` as
its `scoped_model` and adds no owner filter, so the same two-sided policy that
admits a member and the company that published governs the page. The member's
own holding is a correlated subquery on the roll rather than a join, so a
company owner, who names no roll row, reads its own publications with `shares`
null instead of losing them.

A resolution's row also carries its question, its kind and its window, and two
more correlated subqueries on the event chain: `myBallot`, the caller's own
ballot with when it was cast and whether staff entered it, and `result`, the
tally from the close. Both are read through the event chain's own read policy,
never around it, so the database decides what each reader gets: a member their
own ballot and the tally, the company the tally and no ballot. The subquery for
`myBallot` also names the caller's account, so the query is right on its own and
the policy is a second wall rather than the only one. These fields are null for
every other kind. `ballotOutstanding` is a third subquery: true when the caller
is on the resolution's roll and at least one of their roll rows has no ballot
yet, and false for every other kind. It is what the clients offer a ballot on,
rather than `myBallot` being empty, because one account can be on a roll through
two register members: if staff entered a ballot for one holding, `myBallot` is
set while the other holding still has none, and `cast_ballot` casts for it. The
number of queries a page takes does not grow with the resolutions on it, and a
test holds that.

The file route calls `read_publication` rather than the base's `get_object`,
because resolving the row and writing the audit are one act: the service reads
through the policy-scoped connection, opens the stored document, records the
`PublicationRead` on the operator connection, and refuses with 503
`publication_read_unrecorded` if it cannot. A foreign or non-existent uuid answers the same 404 with the same body.

Both clients read it through `@ledova/shared`: `getPublications` for the
listing, a page at a time, `openPublication` for the blob the dashboard saves
through a download link and `downloadPublication` for the bytes the mobile app
writes to one private cache copy and hands to the system share sheet, the way a
company document is opened today. The stored object is named `.bin`, so each
client names its copy with `publicationFilename` from the type served. A download
link, unlike a new tab opened after the response, needs no popup permission.

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

## Resolutions

A resolution is a publication whose members are asked a question. Beside its
document it records, frozen at insert under a per-kind constraint, the question,
whether it is an ordinary or a special resolution, its vote basis and its voting
window. The basis is one vote per share held on the record date (owner decision,
23 September 2026); it is stored rather than assumed, so the declared basis is
part of the record, and every tally counts members as well as shares, so a
head-count reading needs no rebuild. The window's close must be in the future
when the resolution is published. The roll is the publication's own frozen
roll, so the members entitled to vote are exactly the members it was addressed
to, with the shares they held on the record date.

### One append-only chain of events

Ballots and the close are `PublicationEvent` rows, one chain per resolution,
modelled on the [register's own chain](register.md). Each row names its
publication and copies its company, and a ballot names the roll row it is for,
the choice (for, against or abstain), the actor, whether staff entered it and
what they relied on. A `BEFORE INSERT` trigger does everything that makes the
chain trustworthy, and Python supplies none of it:

- It locks the publication row `FOR UPDATE`, so two inserts on one resolution
  are serialised, then allocates the next `sequence` and takes the previous
  event's hash as `previous_hash` (64 zeros for the first). `entry_hash` is
  `shareholders_publication_event_hash`, a SHA-256 over every field under a
  version tag, as `tokens_register_entry_hash` is.
- A ballot is accepted only while the window is open and before any close, for a
  member on this resolution's roll, and its `shares` are copied from that roll
  row whatever the caller sent. A ballot that is not staff-entered must name as
  its actor the account the roll row names, and a roll row with no account
  cannot cast one at all: that is the database's guarantee that a member casts
  only their own ballot. A staff-entered ballot needs an active staff actor and a
  non-blank authority.
- A close is accepted once, and only when the window has passed. The trigger
  writes its `payload` itself from the ballots on the chain: shares and members
  for, against and abstaining, the shares and members on the roll, the basis,
  the kind of resolution and whether it was carried.

The trigger refuses every update, and refuses deletion by the application role;
only the retention purge deletes. Unique indexes hold one sequence number per
position, one ballot per roll row and one close per resolution, so a second
ballot is refused even by a writer who disabled the trigger.

### The tally

An ordinary resolution is carried when the shares voted for exceed the shares
voted against. A special resolution is carried when the shares voted for are at
least 75% of the votes cast, which is the definition of a special resolution in
section 9 of the Corporations Act. The comparison is exact, in whole shares
(four times the shares for against three times the votes cast), so nothing is
rounded at the threshold. Abstentions are counted and
reported but are not votes cast, so they can neither carry nor defeat a
resolution, and a resolution on which no votes were cast is not carried.

### Casting a ballot

A member's ballot is resolved exactly as a member's read is:
`cast_ballot` finds the resolution and the caller's own roll row on the calling
connection, under the policies, and a caller with no roll row gets the same 404
as a resolution that does not exist. Only the insert runs on the operator
connection, because the application role may write nothing to the chain; the
trigger's actor check keeps the guarantee in the database rather than in that
Python. A second ballot, a ballot outside the window and a close before the
window has passed are refused with a validation error that says which.

The member's route is `POST /api/v1/publications/{uuid}/ballot/` with
`{"choice": "for" | "against" | "abstain"}`. It passes `request.user` to
`cast_ballot` and answers with the caller's updated row. A caller who is not on
the resolution's roll, a company owner included, gets the same 404 as a
resolution that does not exist, and nothing is written. A resolution not open
yet, a closed one, a second ballot and an unknown choice are 400s whose body
says which. The route has its own `ballot` throttle scope, ten a minute for each
user, so casting cannot eat into any other write's allowance and the listing is
not throttled by it. Both clients ask the member to confirm that a ballot cannot
be changed before they send it, then reload the listing. Their status comes from
`useResolutionStatus`, which keeps one timer for the next boundary, the opening or
the close, capped at the longest delay a timer holds and re-armed until the
boundary arrives, so a page left open offers the ballot when voting opens and
withdraws it when voting closes without reloading.

Staff enter a ballot in admin for a member who cannot cast one online — a
treasury holding, a member the register could not name, or a member whose vote
a proxy carries. There is no proxy machinery: a proxy is settled between the
member and the company, and the resulting vote is entered by staff, marked
staff-entered and signed with the authority relied on (owner decision 5,
23 September 2026). Either way a roll row has one ballot, which cannot be
changed or withdrawn.

### Closing

`close_resolutions_past_their_window` runs every five minutes and closes each
resolution whose window has passed and has no close yet. Two runs at once close
a resolution once: the second waits on the publication lock, finds the close and
returns it. A late close changes nothing but when the tally appears, because the
trigger refuses every ballot after the window has passed.

### Who may read the chain

| Reader | Reads |
| --- | --- |
| A member | Their own ballot, whoever entered it, and the close of any resolution they are on the roll of |
| The company that published | The close of its own resolutions, and no ballot |
| Ledova staff | Everything, in admin on the operator connection |

The application role may write nothing. The member's ballot term reads the roll
row the ballot names, and the close terms read the roll by publication or the
row's own copied company; the roll's policy reads nothing back.

### Verifying a resolution

`verify_publication` replays the chain on the operator connection and refuses
with `PublicationIntegrityError` on a sequence gap, a broken previous-hash link,
a stored hash that differs from the one recomputed in SQL, an event under
another company, a ballot whose member or shares differ from the roll, two
ballots for one member, an event after the close, or a close whose tally differs
from the tally recomputed in Python from the ballots. The cross-checks are what catch a forger who rewrote a row and
recomputed its hash. The [runbook](../operations/publications.md#verifying-a-resolution)
runs it for every resolution.

## Not built yet

Distributions and their entitlements are the next slices of
[#649](https://github.com/Ledova/ledova/issues/649), adding columns and events to
this spine rather than new tables for the roll.

Next: [publishing to members](../operations/publications.md),
[scheduled jobs](../operations/jobs.md) and
[tenancy](tenancy.md).
