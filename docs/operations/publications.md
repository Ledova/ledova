# Publishing to members

[Operations](README.md) · [Shareholder publications](../architecture/shareholder-publications.md)

A company publishes documents to the members of one share class: today the
annual holding statement, the meeting notice, the resolution put to members
for a vote and the dividend. Ledova staff publish on the
company's written instruction, as
[inspection copies](register-foundation.md#preparing-an-inspection-copy),
certificates and notice figures are prepared today (owner decision,
23 September 2026). The company decides what to publish and when; staff record
the instruction and make the publication.

You need an active staff account with **Can change publication**
(`shareholders.change_publication`) to publish, and **Can view publication**
(`shareholders.view_publication`) to open a published document afterwards. The
share class needs an applied opening, and the company needs a verified company
document carrying the director authority for the publication.

## Making a publication

1. Keep the company's written instruction and note its reference.
2. Confirm the authority document is verified in **Admin → Companies → Company
   documents**. A document verification that has been cleared, or one belonging
   to another company, is refused.
3. In **Admin → Shareholder publications → Publications**, choose **Publish to
   members**.
4. Choose the share class, what is being published, the title members will see,
   the record date and the instruction's reference, choose the verified
   authority document, attach the document as a PDF, PNG or JPEG, and choose
   **Publish**.

The page refuses, and records nothing, when the share class's register has no
applied opening, when the record date is after today in Sydney's calendar, when
no member held shares on that record date, when the instruction or the title is
blank, or when the authority document is not a current verification of a
document of that company. An attachment is size-bounded, scanned and decoded
before it is stored, exactly as every other upload is.

## Publishing a resolution

A resolution is published the same way, on the company's written instruction,
with the resolution and its explanatory statement as the document. On
**Publish to members** choose **Resolution** as what is being published, and
also fill in:

- the question put to members, exactly as the company worded it;
- whether it is an **ordinary** or a **special** resolution;
- when voting opens and when it closes, both in UTC.

Leave those fields blank for anything that is not a resolution: a document with
a question or a voting window is refused. The page also refuses a resolution
with no question, an unknown kind, a window that closes before it opens, or a
window that has already closed. Every member has one vote per share held on the
record date, and the roll frozen at publication is the list of who may vote.
Members with an account are told a resolution has been put to them and cast
their own ballot on **Notices** in the dashboard, or **Publications** in the app; see
[what the member sees](#what-the-member-sees-and-when).

A resolution's page in **Admin → Shareholder publications → Publications**
shows its question, kind and window, the tally once it has closed, and its event
chain — every ballot and the close, in sequence, with their hashes — above the
roll. Seeing the chain needs **Can view publication event**
(`shareholders.view_publicationevent`).

## Entering a ballot for a member

Enter a ballot only for a member who cannot cast one themselves, and only on
something in writing you can name:

- a member the register could not name, a treasury holding, or a member with no
  account, on the company's or the member's written instruction;
- a member who appointed a proxy the company accepted, on the proxy form.

Ledova does not manage proxies. The member and the company settle the
appointment between them, and the vote it carries is entered here, marked as
entered by staff (owner decision, 23 September 2026).

1. Open the resolution and choose **Enter a ballot**. You need **Can change
   publication** (`shareholders.change_publication`).
2. Choose the member on the roll. Members who already have a ballot, whether
   they cast it or staff entered it, are not offered.
3. Choose for, against or abstain, and record what you relied on, such as the
   reference of the signed proxy form. Choose **Record the ballot**.

The ballot is chained with your account as its actor and the authority you
recorded. It cannot be changed or withdrawn, by you or by the member: a member
with a ballot entered for them cannot cast another. The page refuses, and
records nothing, when voting has not opened or has closed, when the member
already has a ballot, or when the authority is blank.

## Publishing a dividend

A dividend is published the same way, on the company's written instruction, with
the company's dividend notice as the document. On **Publish to members** choose
**Dividend** as what is being published, and also fill in, exactly as the
company's instruction states them:

- the rate per share in AUD, to at most six decimal places;
- the date the dividend was declared;
- the date the company will pay it, which cannot be before the record date;
- the total the company declared.

The total is a check on the rate. The page refuses the dividend, and records
nothing, unless the total is exactly the shares on the roll times the rate,
rounded down to the cent, and the refusal says what the total should have been.
When that happens, do not change either figure yourself: go back to the company,
because one of the two figures in its instruction is wrong. The page also
refuses a rate of zero or less, or to more than six decimal places, a
declaration dated in the future, a payment date before the record date, a rate
at which the members between them are owed less than a cent, and any of these
fields on something that is not a dividend.

Each member on the roll is entitled to their shares on the record date times the
rate, rounded down to the cent, and whatever rounding leaves over is recorded as
undistributed rather than given to anyone (owner decision, 23 September 2026).
It is always less than a cent for each member. The dividend's page in **Admin →
Shareholder publications → Publications** shows the rate, the dates, the
declared total and the undistributed amount, each member's entitlement on the
roll, and its payment records, in sequence with their hashes. Seeing the records
needs **Can view publication event** (`shareholders.view_publicationevent`).

## Recording a payment

Ledova does not move money and cannot see a bank transfer. Record a payment only
on the company's written advice that it has paid a member, and attach the
remittance evidence the company gave you. What you record is the company's
statement that it paid, and members are shown exactly that.

1. Open the dividend and choose **Record a payment**. You need **Can change
   publication** (`shareholders.change_publication`).
2. Choose the member on the roll. Only members owed at least a cent and with no
   standing record are offered, each with their shares and entitlement.
3. Enter the date the company says it paid, the company's payment reference, the
   remittance evidence as a PDF, PNG or JPEG, and what you relied on, such as the
   reference of the company's payment advice. Choose **Record the payment**.

The record names you and cannot be changed. The page refuses, and records
nothing, when the date is in the future or before the dividend was declared, the
reference or what you relied on is blank, the evidence is not an accepted file,
or the member already has a standing record.

## Withdrawing a payment record

A record is withdrawn, never edited. Withdraw one only on the company's written
correction: a payment recorded against the wrong member, on the wrong date or
with the wrong reference, or one the company says did not go through.

1. Open the dividend and choose **Withdraw a payment record**. Only members whose
   latest record is a payment are offered.
2. Choose the member, record why, such as the reference of the company's
   correction, and choose **Withdraw the record**.

The original record stays on the chain with your withdrawal after it. To correct
a record, withdraw it and then record the correct one; the member sees the new
record in place of the old.

## Closing a resolution and reading the tally

Nothing needs doing. `close_resolutions_past_their_window` runs every five
minutes ([background jobs](jobs.md#schedule)) and closes each resolution whose
voting window has passed. The database writes the tally into the close from the
ballots on the chain: the shares and members for, against and abstaining, the
shares and members on the roll, and whether it was carried.

- An **ordinary** resolution is carried when the shares voted for exceed the
  shares voted against. A tie is not carried.
- A **special** resolution is carried when the shares voted for are at least 75%
  of the votes cast (Corporations Act, section 9).
- Abstentions are shown but are not votes cast, and a resolution on which no
  votes were cast is not carried.

The tally appears on the resolution's page once it has closed. If the worker is
not running nothing closes, but nothing can be cast either: the database refuses
every ballot once the window has passed, so a late close changes only when the
tally appears, never what it says. Start the worker as
[background jobs](jobs.md) describes.

## What a publication records

Each publication is one row in **Admin → Shareholder publications →
Publications**: the company and share class and the names they carried when it
was made, what was published, the record date, the instruction's reference, the
authority document and its fingerprint, the SHA-256 of the stored document, the
register sequence and head hash the roll was taken from, the number of members
it was addressed to, the roll's own digest and the staff member who prepared it.
Unlike an inspection copy, Ledova keeps the document itself: a member must be
able to reopen it later.

Below it is the roll, one row for each member holding shares on the record date:
the register member, the account it resolved to, the name as at that moment, the
holder type, where the identity came from and the shares held. A member the
register cannot name — whose wallets resolve to different people, a treasury
address, or one never identified — is on the roll with no account. They are on
the audience for the company's records and have no online surface, and the
company reaches them the way it reaches any member it cannot address online.

Nothing on a publication or its roll can be changed afterwards. The database
refuses every update, and there is no admin path to add, change or delete one.

## What the member sees, and when

Publishing is what reaches the member: there is nothing else for you to send.
Once the roll commits, every member on it who has an account is sent an ordinary
notification naming the publication. A member the register could not name is on
the roll, has no account, and is told nothing — reach them the way the company
reaches any member it cannot address online.

The notification opens **Notices** in the dashboard and **Publications** in the app. There
the member sees, for each publication addressed to them: what was published, its
title, the company and share class, the record date, and their own holding as it
was frozen on that date — not their holding today. **Open the document** saves
a copy of the stored document itself. Older publications appear a page at a time. A company owner sees its own company's
publications on the same page, with no holding of its own.

A resolution also shows its question, whether it is ordinary or special, its
voting window and whether it is not open yet, open or closed, with the member's
frozen holding as their votes. While it is open and they have not voted, the
member chooses for, against or abstain and confirms, having been told a ballot
cannot be changed. Once they have voted the page says how, and whether staff
entered the ballot for them. A member who holds through two register entries,
one of which you entered a ballot for, is told part of their holding has no
ballot yet and may cast it for the rest. The page opens and closes voting at
the window's times even if it was left open. Once it has closed, it shows the
tally: shares and members for, against and abstaining, turnout against those
eligible, and whether it was carried. A company owner sees the same resolution
and its tally, and is never offered a ballot. If a ballot is refused, the page
shows why, in the words the server used: voting has not opened, has closed, or a
ballot was already recorded.

A dividend shows the declared rate per share, the member's frozen holding, their
entitlement and how it was worked out, and the payment date. Below them is what
the company recorded: "The company recorded this as paid on 3 October 2026,
reference LDV-4412", or that no payment has been recorded yet, with a line saying
that Ledova shows what the company recorded and does not move the money. A member
whose holding comes to less than a cent is told there is nothing to pay. A
person holding through two register members sees their two entitlements added
together. If only one holding has a payment record, they are told how much of
the total the company has recorded, with the most recent record's date and
reference, and that the rest has no payment record yet. A company owner sees the rate and the payment date, and no entitlement
or payment of its own. Publishing a dividend notifies members that it has been
declared; recording a payment sends no notification.

Nothing on that page names another member, and no holding, ballot, entitlement
or payment record but the reader's own is served: the roll rows and the events
behind each line are the reader's, chosen by the database rather than by the
page.

## Opening a published document

Open a publication and choose **Open the published document**. It downloads
rather than rendering. Each read — a member's, the company's, or yours — is
recorded once in **Admin → Shareholder publications → Publication reads**: who
read it, which publication, which roll row where there is one, and in which
capacity. A read that cannot be recorded refuses the download rather than
serving it, and a stored document that cannot be opened is refused before any
read is recorded, so every record is of a document that was served. A member whose read
cannot be recorded is told that nothing was served and to try again shortly; the
document is not shown.

Those records cannot be rewritten or deleted in admin, are read only by staff,
and carry no name, holding or document content. To confirm that a file is the
one published, compare the output of `sha256sum` on it with the publication's
digest.

### Opening a payment's remittance evidence

On a dividend's page, each payment record has **Open the remittance evidence**
beside it. You need **Can view publication** (`shareholders.view_publication`)
and **Can view publication event** (`shareholders.view_publicationevent`). The
evidence downloads as the file type it was found to be when it was recorded. Its
SHA-256 is on the same row, to compare with `sha256sum` on the copy you
downloaded. Each opening is recorded in **Publication reads** like any other
read, with the payment record's identifier in the event column. As with a
published document, evidence that cannot be opened, or a read that cannot be
recorded, serves nothing.

## Checking a frozen roll and verifying a resolution

The roll is frozen when the publication is made, and the publication records how
many rows it held and a digest of them. From `backend/`:

```bash
python manage.py publications verify --publication PUBLICATION_UUID
```

Leaving `--publication` out checks every publication. The command prints the row
count and digest it recomputed for each, and fails naming the publication whose
roll no longer matches what it recorded. It reads the stored roll only: it
proves that the audience a publication was addressed to has not changed since,
not that the register itself is sound, which
`register_foundation verify` answers ([the synthetic operator
exercise](register-foundation.md#synthetic-operator-exercise)).

### Verifying a resolution

For a resolution the same command also replays its event chain and prints, beside
the roll's row count and digest, the number of events, the chain's head hash,
the number of ballots and the tally — `null` until it has closed. It fails,
naming the publication, when a sequence number is missing, when an event's
stored hash or its link to the one before does not recompute, when an event
names another company, when a ballot's member or shares differ from the roll,
when one member has two ballots, when an
event follows the close, or when the tally in the close differs from the tally
recomputed from the ballots. Nothing the application does can cause any of
these: they mean someone with the schema owner's rights rewrote the chain.

### Verifying a distribution

For a dividend the command replays its payment records and rechecks its
arithmetic, and prints the number of events, the chain's head hash, the number
of standing payment records and the undistributed amount. It fails, naming the
publication, on the same chain faults as a resolution, and when a payment is
recorded for a member the roll does not entitle to one, when one member has two
standing records, when a withdrawal has nothing to withdraw, when an event is a
ballot or a close, when an entitlement is not the member's shares times the rate
rounded down, or when the declared total or the undistributed amount does not
agree with the roll. As for a resolution, only a rewrite with the schema owner's
rights can cause these.

## Retention

Publications, their rolls, their read records, a resolution's ballots and
close, and a dividend's payment records with their stored remittance evidence
are kept for seven years from the publication and purged together by
`purge_publications_past_the_clock`,
daily at 03:50. They share `FORMER_MEMBER_RETENTION_DAYS` with the register's
own outputs, so one clock governs both and a value below 2,557 days refuses the
purge rather than shortening it; see
[retention settings](uploads.md#data-retention). The purge deletes the stored
document with the row. Nothing else removes a publication.
