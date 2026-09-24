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

The kinds are the annual holding statement, the meeting notice, the
[resolution](#resolutions) and the [distribution](#distributions), which members
see as a dividend. A publication's `kind` is an open list, and the columns every
kind needs — the company, the share class, the record date, the instruction, the
authority and the snapshot head — sit on the row itself, so a resolution and a
distribution join the same table rather than starting another one. The per-kind
constraint that requires stored bytes and a digest names the document kinds it
applies to, so a kind that carries no file does not have to rewrite it. A
resolution carries its document too, the resolution and its explanatory
statement, and a distribution carries the company's dividend notice.

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
refuses with 503 `publication_unopened` and records nothing. Staff opening a
distribution's [remittance evidence](#payment-records) are audited the same
way, on the same table, with the payment record named as well.

## Retention

A publication, its roll, its read records and, for a resolution or a
distribution, its event chain are kept for the register's own seven-year floor
and purged together by a daily job, the chain before the roll it points at. A
payment record's stored remittance evidence is deleted with its row, through the
same private-file lifecycle receiver as the publication's own document. They share
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
| `GET /api/v1/publications/` | What was published to this principal, newest first, with the caller's own holding, ballot, entitlement and recorded payment |
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

A distribution's row carries its rate per share, currency, declaration date and
payment date, and two more figures of the caller's own: `myEntitlement`, the
entitlements of every roll row naming the caller added together, because one
person can hold through two register members; and `myPaymentRecord`, the latest
[payment record](#payment-records) for those rows that has not been withdrawn,
as `recordedPaidOn`, `reference` and `recordedAt`, or null. Both are correlated
subqueries read through the policies and naming the caller, as `myBallot` is,
so the company owner, who names no roll row, sees the distribution with no
entitlement or record of its own. The declared total and the undistributed
remainder are the company's figures and are not in the listing. No field name
says a payment was made; see
[what is recorded and what is claimed](#what-is-recorded-and-what-is-claimed).

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

## Distributions

A distribution is a publication whose members are owed a dividend. Staff
publish it on the company's written instruction, like every other kind, with the
company's dividend notice as its document. Beside the roll it freezes, under a
per-kind constraint, the rate per share, the currency (AUD only for now), the
date the dividend was declared, the date it will be paid, which cannot be before
the record date, the total the company declared and the amount left
undistributed.

### The rate is the input and the total is a check figure

A board resolves a rate — "2.5 cents per ordinary share" — so the rate is what
staff enter, to at most six decimal places. The declared total is entered as
well, and publishing is refused unless it is exactly the eligible shares on the
frozen roll times the rate, rounded down to the cent (owner decision 6,
23 September 2026). A typing error in either figure then shows as a disagreement
between them, and the refusal says what the total should have been.

### Entitlements live on the roll

Each roll row of a distribution carries its `entitlement`: the row's shares times
the rate, rounded **down** to the cent (owner decision 3, 23 September 2026).
There is no entitlement table, because the roll already is the list of who is
owed what, with the shares they held on the record date. The rule needs no
tie-break, and the company can never owe more than it declared. What rounding
leaves over is recorded on the publication as `undistributed` rather than given
to anyone. It is never negative and always less than one cent for each member on
the roll. The arithmetic is exact at any size: a holding of 78 digits is
multiplied without rounding, and a total too large to record is refused.

The database holds this, not only Python. The roll guard trigger refuses a
distribution's roll row whose entitlement is not its shares times the rate
rounded down, and any other kind's row that carries one. The publication row is
inserted before its roll, so the sum cannot be checked when that row is
inserted; instead a deferred constraint trigger runs at commit and refuses a
distribution whose declared total is not its roll's shares times its rate
rounded down, or whose entitlements and remainder do not add up to that total.

### Payment records

Ledova moves no money. A company pays its members through its own bank, and
what the platform keeps is the company's statement that it has paid, entered by
staff on the company's written advice. A payment record is an event on the
publication's own [event chain](#one-append-only-chain-of-events), of one of two
kinds:

- `payment` names the roll row, the date the company says it paid, the company's
  payment reference, the remittance evidence the company supplied (stored
  privately with the record, with its SHA-256 and the type the upload validator
  found it to be), the staff member who entered it and what they relied on.
- `payment_void` withdraws the standing record for a roll row, with the reason.

A record is never changed. A correction is a withdrawal followed by a new
record, so the history of what the company said, and when, survives. The event
trigger admits only these two kinds on a distribution, and ballots and closes
only on a resolution. It admits a `payment` only for a roll row owed at least a
cent whose latest record is not a standing payment, a `payment_void` only for a
roll row whose latest record is one, and either only from an active staff
member. A payment record hashes under its own version tag, covering the date,
the reference, the stored evidence, its digest and its type, so the ballots
already on a chain keep the hash they were given.

Staff open the evidence from the distribution's page in admin, beside its
payment record, through the same `admin_file_path` route as the published
document, as an attachment of the stored type. Opening it needs view permission
on publications and on their event records. Each read is a `PublicationRead`
naming the reader, the distribution, the roll row and, in `event_uuid`, the
payment record. That column is what tells an evidence read apart from a read of
the dividend notice, and the record shares the publication's operator-only
table, seven-year clock and purge. The rule is
[the one every read follows](#every-read-is-audited-and-an-unrecorded-read-is-refused):
the stored evidence is opened first and the read recorded second, and a read
that cannot be recorded serves nothing.

### What is recorded and what is claimed

| Recorded: the platform can show it | Claimed: the platform cannot show it |
| --- | --- |
| The rate, the dates and the total, the company's authority and its dividend notice | That the board resolved it |
| Each member's frozen holding and entitlement | — |
| Who entered a payment record, when, and what they relied on | That money left an account |
| The payment reference the company supplied | That it matches a real transfer |
| The SHA-256 of the remittance evidence the company supplied | That the remittance is genuine |

The wording follows the table. Every member-facing sentence and every API field
says that the company **recorded** a payment, never that the member was paid:
"The company recorded this as paid on 3 October 2026, reference LDV-4412". The
same discipline governs `Wallet.signing_preference`, which is self-declared and
attests nothing. One test scans the shared copy, and another the API's field
names, for "paid" without "recorded".

### Who may read a distribution's records

| Reader | Reads |
| --- | --- |
| A member | Their own roll rows' entitlements, and the payment records and withdrawals for those rows |
| The company that published | The whole roll with every entitlement, and every payment record of its own distributions, because it is the payer |
| Ledova staff | Everything, in admin on the operator connection |

The resolution terms are unchanged. The member's payment term reads the roll row
each record names; the company's term reads the record's own copied company.

### Verifying a distribution

`verify_publication` replays a distribution's chain with the same sequence, hash
and company checks as a resolution's, and also refuses an event of a kind a
distribution does not take, a payment record for a roll row it does not owe, a
second standing record for one roll row, a withdrawal with nothing to withdraw,
an entitlement that is not its shares times the rate rounded down, and a declared
total or remainder that does not agree with the roll. It reports the number of
standing records and the remainder. The
[runbook](../operations/publications.md#verifying-a-distribution) runs it.

### The distribution statement

Owner decision 4 put the distribution statement with the dividend work. In this
slice the member's own row is that statement: the rate, their frozen holding,
their entitlement, the payment date and what the company recorded, read through
the listing. A generated per-holder document is left until a company asks for
one ([decisions](../decisions.md#shareholder-publications)).

## Not built yet

Entitlements in the holdings and history views, and a count on the home page,
are the next slice of [#649](https://github.com/Ledova/ledova/issues/649).

Next: [publishing to members](../operations/publications.md),
[scheduled jobs](../operations/jobs.md) and
[tenancy](tenancy.md).
