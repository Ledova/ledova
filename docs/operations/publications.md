# Publishing to members

[Operations](README.md) · [Shareholder publications](../architecture/shareholder-publications.md)

A company publishes documents to the members of one share class: the annual
holding statement, the meeting notice, the resolution put to members for a vote
and the dividend. Platform staff publish on the company's written instruction
until [#870](https://github.com/Ledova/ledova/issues/870), which is deferred
(owner decision, 23 September 2026); the company decides what to publish and
when. [Shareholder publications](../architecture/shareholder-publications.md)
holds every rule this runbook relies on: what a publication
[records](../architecture/shareholder-publications.md#one-record-for-everything-a-company-publishes),
why the [bytes are stored](../architecture/shareholder-publications.md#stored-bytes-not-a-regenerated-document),
how the [roll is frozen](../architecture/shareholder-publications.md#the-frozen-roll),
[who may read](../architecture/shareholder-publications.md#who-may-read-a-publication)
and [what the member sees](../architecture/shareholder-publications.md#the-members-route).

You need an active staff account with **Can change publication**
(`shareholders.change_publication`) to publish, and **Can view publication**
(`shareholders.view_publication`) to open a published document afterwards. The
share class needs an applied opening and must be on chain, deployed or paused,
and the company needs a [verified company document](register-foundation.md#reviewing-documentary-evidence)
carrying the director authority for the publication. Publish to the members of
a paused class as to any other
([a paused class keeps its members](../architecture/shareholder-publications.md#a-paused-class-keeps-its-members)).

## Making a publication

1. Keep the company's written instruction and note its reference.
2. Confirm the authority document is verified in **Admin → Companies → Company
   documents**. A verification that has been cleared, or a document of another
   company, is refused.
3. In **Admin → Shareholder publications → Publications**, choose **Publish to
   members**.
4. Choose the share class, what is being published, the title members will see,
   the record date and the instruction's reference, choose the verified
   authority document, attach the document as a PDF, PNG or JPEG, and choose
   **Publish**.

The page refuses, and records nothing, when the share class's register has no
applied opening, when the class is not on chain (a class whose register an
import opened before it was deployed), when the record date is after today in
Sydney's calendar, when no member held shares on that record date, when the
instruction or the title is blank, or when the authority document is not a
current verification of a document of that company. An attachment is
size-bounded, scanned and decoded before it is stored, exactly as every other
upload is. Publishing is what reaches the member
([every publication is announced](../architecture/shareholder-publications.md#every-publication-is-announced));
a member the register could not name is on the roll with no account and is told
nothing, so the company reaches them the way it reaches any member it cannot
address online.

## Publishing a resolution

A resolution is published the same way, with the resolution and its explanatory
statement as the document. On **Publish to members** choose **Resolution** and
also fill in the question put to members, exactly as the company worded it,
whether it is an **ordinary** or a **special** resolution, and when voting opens
and closes, both in UTC. Leave those fields blank for anything that is not a
resolution: a document with a question or a voting window is refused. The page
also refuses a resolution with no question, an unknown kind, a window that
closes before it opens, or a window that has already closed. Every member has
one vote per share held on the record date, and the frozen roll is the list of
who may vote; members with an account cast their own ballot on **Notices**
([casting a ballot](../architecture/shareholder-publications.md#casting-a-ballot)).

The resolution's admin page shows its question, kind and window, the tally once
it has closed, and its [event chain](../architecture/shareholder-publications.md#one-append-only-chain-of-events),
every ballot and the close with their hashes, above the roll. Seeing the chain
needs **Can view publication event** (`shareholders.view_publicationevent`).

## Entering a ballot for a member

Enter a ballot only for a member who cannot cast one themselves, and only on
something in writing you can name: a member the register could not name, a
treasury holding or a member with no account, on the company's or the member's
written instruction; or a member who appointed a proxy the company accepted, on
the proxy form. Ledova does not manage proxies (owner decision, 23 September
2026).

1. Open the resolution and choose **Enter a ballot**. You need **Can change
   publication**.
2. Choose the member on the roll. Members who already have a ballot, whether
   they cast it or staff entered it, are not offered.
3. Choose for, against or abstain, record what you relied on, such as the
   reference of the signed proxy form, and choose **Record the ballot**.

The ballot is chained with your account as its actor and the authority you
recorded, and cannot be changed or withdrawn by you or by the member. The page
refuses, and records nothing, when voting has not opened or has closed, when the
member already has a ballot, or when the authority is blank.

## Publishing a dividend

A dividend is published the same way, with the company's dividend notice as the
document. On **Publish to members** choose **Dividend** and also fill in,
exactly as the company's instruction states them, the rate per share in AUD to
at most six decimal places, the date the dividend was declared, the date the
company will pay it, which cannot be before the record date, and the total the
company declared. The total is a check on the rate: the page refuses the
dividend unless the total is exactly the shares on the roll times the rate,
rounded down to the cent, and the refusal says what the total should have been
([the rate is the input](../architecture/shareholder-publications.md#the-rate-is-the-input-and-the-total-is-a-check-figure)).
When that happens, do not change either figure yourself: go back to the
company, because one of the two figures in its instruction is wrong. The page
also refuses a rate of zero or less, or to more than six decimal places, a
declaration dated in the future, a payment date before the record date, a rate
at which the members between them are owed less than a cent, and any of these
fields on something that is not a dividend.

The dividend's admin page shows the rate, the dates, the declared total and the
undistributed amount, each member's
[entitlement](../architecture/shareholder-publications.md#entitlements-live-on-the-roll)
on the roll, and its payment records in sequence with their hashes; seeing the
records needs **Can view publication event**. Publishing a dividend notifies
members that it has been declared; recording a payment sends no notification.

## Recording a payment

Ledova does not move money and cannot see a bank transfer. Record a payment only
on the company's written advice that it has paid a member, and attach the
remittance evidence the company gave you; what you record is the company's
statement that it paid, and members are shown exactly that
([what is recorded and what is claimed](../architecture/shareholder-publications.md#what-is-recorded-and-what-is-claimed)).

1. Open the dividend and choose **Record a payment**. You need **Can change
   publication**.
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
with the wrong reference, or one the company says did not go through. Open the
dividend, choose **Withdraw a payment record**, choose the member (only members
whose latest record is a payment are offered), record why, such as the
reference of the company's correction, and choose **Withdraw the record**. The
original record stays on the chain with your withdrawal after it; to correct a
record, withdraw it and then record the correct one, and the member sees the
new record in place of the old
([payment records](../architecture/shareholder-publications.md#payment-records)).

## Closing a resolution and reading the tally

Nothing needs doing. `close_resolutions_past_their_window` runs every five
minutes ([background jobs](jobs.md#schedule)) and closes each resolution whose
voting window has passed; the tally then appears on the resolution's page
([closing](../architecture/shareholder-publications.md#closing),
[the tally](../architecture/shareholder-publications.md#the-tally)). If the
worker is not running nothing closes, but nothing can be cast either: the
database refuses every ballot once the window has passed, so a late close
changes only when the tally appears, never what it says. Start the worker as
[background jobs](jobs.md) describes.

## Opening a published document

Open a publication and choose **Open the published document**. It downloads
rather than rendering, and each read is recorded once in **Admin → Shareholder
publications → Publication reads**; a read that cannot be recorded serves
nothing ([every read is audited](../architecture/shareholder-publications.md#every-read-is-audited-and-an-unrecorded-read-is-refused)).
To confirm that a file is the one published, compare the output of `sha256sum`
on it with the publication's digest. On a dividend's page, **Open the
remittance evidence** beside each payment record downloads the evidence as the
type it was found to be, needs **Can view publication** and **Can view
publication event**, shows its SHA-256 on the same row, and is recorded in
**Publication reads** with the payment record's identifier in the event
column. Nothing on a publication or its roll can be changed afterwards;
[retention](../architecture/shareholder-publications.md#retention) says how
long they are kept and what removes them.

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
not that the register itself is sound, which `register_foundation verify`
answers ([the synthetic operator exercise](register-foundation.md#synthetic-operator-exercise)).

### Verifying a resolution

For a resolution the same command also replays its event chain and prints,
beside the roll's row count and digest, the number of events, the chain's head
hash, the number of ballots and the tally, `null` until it has closed. It fails,
naming the publication, on any fault that
[verifying a resolution](../architecture/shareholder-publications.md#verifying-a-resolution)
lists. Nothing the application does can cause any of these: they mean someone
with the schema owner's rights rewrote the chain.

### Verifying a distribution

For a dividend the command replays its payment records and rechecks its
arithmetic, and prints the number of events, the chain's head hash, the number
of standing payment records and the undistributed amount. It fails, naming the
publication, on any fault that
[verifying a distribution](../architecture/shareholder-publications.md#verifying-a-distribution)
lists. As for a resolution, only a rewrite with the schema owner's rights can
cause these.
