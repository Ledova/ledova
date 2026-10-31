# Shareholder publications

[Business processes](README.md) · [Documentation](../README.md)

What a company publishes to its members through Ledova (holding statements, meeting notices,
resolutions with online ballots, and dividends with their payment records), what members and the
company see, and the procedure platform staff follow on a company's written instruction. Storage,
audit and chaining are in [publication records](../engineering/records.md#publications).

Contents:

- [Who publishes](#who-publishes)
- [What a publication is](#what-a-publication-is)
- [Which classes can be published to](#which-classes-can-be-published-to)
- [The frozen roll](#the-frozen-roll)
- [Who may read a publication](#who-may-read-a-publication)
- [How members are told](#how-members-are-told)
- [How long publications are kept](#how-long-publications-are-kept)
- [Resolutions](#resolutions)
- [Dividends](#dividends)
- [Publishing on the company's instruction](#publishing-on-the-companys-instruction)
- [The Published page](#the-published-page)
- [The Notices page](#the-notices-page)

## Who publishes

The company decides what to publish and when; platform staff publish, enter represented ballots and
record payments on its written instruction. Company-run publishing is deferred under
[#870](https://github.com/Ledova/ledova/issues/870) by the
[9 October priority](../decisions.md#essential-registry-and-development-workflow-priority). A
company-run replacement must keep every rule on this page (frozen rolls, actor attribution, evidence
bound to content, voting windows, one ballot per holding, exact arithmetic, read records and
retention) and must not relabel a historical staff-entered event as a company decision
([decisions](../decisions.md#shareholder-publications)).

## What a publication is

A publication is one record of one thing a company publishes to the members of one share class. Its
kinds are the **Annual holding statement**, the **Meeting notice**, the **Resolution** and the
**Dividend**. Each carries:

- the document itself: the statement or notice, a resolution with its explanatory statement, or the
  company's dividend notice;
- the company's written instruction and its authority, which is a
  [verified company document](companies.md#staff-verification-of-a-company-document) of the
  same company carrying the directors' authority;
- the roll of members it was addressed to, frozen when it was made;
- the company's name and the share class's name and symbol as they were then.

A publication is frozen: nothing on it or its roll can be changed afterwards, and the only deletion
is the retention purge. The document is stored exactly as published, so a member who reopens a
statement in June reads the same bytes, and the same names, that they read in March.

## Which classes can be published to

The share class needs an applied register opening and must be on chain, deployed or paused. A
class whose register an import opened before it was ever deployed is not on chain and cannot be
published to; publishing to it is deferred under #870.

A pause stops transfers, not membership: a paused class leaves the market, but
the company still publishes to its members, puts resolutions to them and declares dividends on
their shares, and they read, vote and see payment records exactly as other members do.

## The frozen roll

When a publication is made, Ledova replays the class's register to the record date and writes one
row for each member holding shares then: the register member, the account it resolves to, the name
at that moment, the holder type, the identity source and the shares held. The row count and a
fingerprint are recorded, so a roll that no longer matches can be reported rather than assumed.

Identity is resolved once, by the register's own rules
([membership and identity](register.md#members-holder-types-and-identity)), and never from a wallet
address alone: two accounts can record the same address, and matching by address could hand one
member's statement to another. A named member without a linked wallet can receive the publication
through their current [member-access association](member-records.md#member-access) in that company.
The account is frozen when the publication is made; revocation affects future publications rather
than changing earlier recipients. Existing wallet identity and ambiguity rules still apply.

A member the register cannot name (ambiguous, treasury or
unidentified) stays on the roll for the company's records, with no account and nothing online; the
company reaches them another way, and staff can
[enter their ballots](#entering-a-ballot-for-a-member).

## Who may read a publication

| Reader                         | Publications                                    | Resolutions                                                                         | Dividends                                                                          |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A member                       | Those addressed to them, and their own roll row | Their own ballot, whoever entered it, and the result of any they are on the roll of | Their own roll rows' entitlements, and those rows' payment records and withdrawals |
| The company, through its owner | Its own publications and their whole roll       | The result of its own resolutions, and no ballot                                    | The whole roll with every entitlement and payment record, as the payer             |
| Platform staff                 | Everything, in admin                            | Everything                                                                          | Everything                                                                         |

A company appointment gives no publication access. Every delivery of a document, or of a
dividend's remittance evidence to staff, is recorded with the reader, the publication, the roll row
where there is one, and whether the reader was the member, the company or staff. A read that cannot
be recorded is refused rather than served, and a document that cannot be opened is refused and
recorded nowhere. A [company pack](member-records.md#the-company-pack) carries read counts, never
who opened what.

## How members are told

Once the roll is frozen, each member with an account receives one ordinary notification, with no new
preference switch ([decision](../decisions.md#shareholder-publications)). It names the publication
and its kind and opens Notices; it carries no holding and no document, which the member reaches only
through their own recorded read. Publishing a dividend notifies members that it has been declared;
recording a payment sends no notification.

## How long publications are kept

A publication, its roll, its read records and, for a resolution or dividend, its ballots, close and
payment records are kept for the register's seven-year floor (2,557 days), measured from the
publication, and then purged together by a daily job. A payment record's remittance evidence is
deleted with it. The floor cannot be configured shorter
([retention](../engineering/security.md#retention-clocks)).

## Resolutions

A resolution is a publication that asks its members a question. Beside its document it records the
question, whether it is an ordinary or a special resolution, its vote basis and its voting window,
all fixed when it is published. Those entitled to vote are exactly the roll, with one vote per share
held on the record date, and every tally counts members as well as shares.

Ballots and the close form one append-only record per resolution, each linked to the one before by a
fingerprint, so a rewritten ballot can be detected
([mechanism](../engineering/records.md#event-chain)).

### The tally

An ordinary resolution is carried when the shares voted for exceed the shares voted against; a tie
is not carried. A special resolution is carried when the shares voted for are at least 75% of the
votes cast (section 9 of the Corporations Act). The comparison is exact, in whole shares.
Abstentions are counted and reported but are not votes cast, so they neither carry nor defeat a
resolution, and a resolution on which no votes were cast is not carried.

### Casting a ballot

A member with an account votes on **Notices**: they choose **For**, **Against** or **Abstain**, read
that a ballot cannot be changed or withdrawn once cast, and choose **Cast my ballot**. A member
casts only their own ballot, for the shares the roll gives them. A ballot from someone not on the
roll, a company owner included, is refused as if the resolution did not exist, and nothing is
recorded; one before voting opens, after it closes or a second one is refused with a reason. The
page offers the ballot when voting opens and withdraws it when voting closes, without reloading.

Each roll row has one ballot. One person can be on a roll twice, through two register members; if
one holding already has a ballot, the page says part of the holding has no ballot yet and a ballot
cast now counts for that part.

Platform staff enter a ballot for a member who cannot cast one online: a treasury holding, a member
the register could not name or a member with no account, on the company's or the member's written
instruction; or a member who appointed a proxy the company accepted, on the proxy form. Ledova does
not manage proxies ([decision](../decisions.md#shareholder-publications)). A staff-entered ballot is
marked "Voted for you by staff", names the authority relied on, and cannot be changed or withdrawn.

### Closing a resolution

A resolution closes automatically within five minutes after its window ends, and the tally then
appears; staff need do nothing. Ballots are refused once the window has passed, so a late close
changes only when the tally appears, never what it says. Without a running background worker
nothing closes, though ballots are still refused.

## Dividends

A dividend is a publication whose members are owed a payment, with the company's dividend notice as
its document. Beside the frozen roll it records the rate per share, the currency (AUD only), the
declaration and payment dates, the declared total and the amount left undistributed.

### The rate and the declared total

The rate is the input, to at most six decimal places and above zero; the declared total is a check
figure. Publishing is refused unless the total is exactly the shares on the roll times the rate,
rounded down to the cent, and the refusal says what the total should have been, so a typing error in
either figure is caught. Also refused: a declaration dated in the future, a payment date before the
record date, and a rate at which the members between them are owed less than a cent.

### Entitlements and the undistributed remainder

Each roll row carries its entitlement: its shares times the rate, rounded down to the cent. What
rounding leaves over is recorded as undistributed rather than given to anyone, so the company never
owes more than it declared. The remainder is never negative and always less than one cent for each
member on the roll. The arithmetic is exact at any size, and a total too large to record is refused.

### Payment records

Ledova moves no money and cannot see a bank transfer. A payment record is the company's statement
that it paid a member, entered by staff on the company's written advice:

- a payment names the roll row, the date the company says it paid, the company's payment reference,
  the remittance evidence the company supplied, the staff member who entered it and what they
  relied on;
- a withdrawal removes the standing record for a roll row, with the reason.

A record is never changed. A correction is a withdrawal followed by a new record, so the history of
what the company said, and when, survives. A payment can be recorded only for a roll row owed at
least a cent that has no standing record, and withdrawn only where one stands.

### What is recorded and what is claimed

| Recorded: Ledova can show it                                                       | Claimed: Ledova cannot show it  |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| The rate, the dates and the total, the company's authority and its dividend notice | That the board resolved it      |
| Each member's frozen holding and entitlement                                       | —                               |
| Who entered a payment record, when, and what they relied on                        | That money left an account      |
| The payment reference the company supplied                                         | That it matches a real transfer |
| The fingerprint of the remittance evidence the company supplied                    | That the remittance is genuine  |

Every member-facing sentence says that the company recorded a payment, never that the member was
paid: "The company recorded this as paid on 3 October 2026, reference LDV-4412". Where a person
holds through two register members, the whole entitlement reads as recorded only when every holding
has a record; otherwise the page says how much the company has recorded and that the rest has no
record yet.

### The distribution statement

The member's own row on **Notices** is the distribution statement: the rate, their frozen holding,
their entitlement, the payment date and what the company recorded. A generated per-holder document
is not built; it waits until a company asks for one.

## Publishing on the company's instruction

You need an active staff account with **Can change publication** to publish, enter ballots and
record payments; **Can view publication** to open a published document; and **Can view publication
event** to see ballots and payment records.

### Making a publication

1. Keep the company's written instruction and note its reference.
2. Check that the share class [can be published to](#which-classes-can-be-published-to) and that the
   company's authority document is [verified](companies.md#staff-verification-of-a-company-document)
   in **Admin → Companies → Company documents**.
3. In **Admin → Shareholder publications → Publications**, choose **Publish to members**.
4. Choose the share class, the kind, the title members will see, the record date and the
   instruction's reference, choose the verified authority document, attach the document as a PDF,
   PNG or JPEG, and choose **Publish**.

Refused, with nothing recorded, when the class cannot be published to, the record date is after
today in Sydney's calendar, no member held shares on that date, the instruction or title is blank,
or the authority is not a current verification of a document of that company. The attachment is
checked as every upload is.

### Publishing a resolution

Publish as above with the resolution and its explanatory statement as the document, choose
**Resolution**, and fill in the question exactly as the company worded it, **ordinary** or
**special**, and when voting opens and closes, both in UTC; these fields stay blank for other
kinds. Refused when another kind carries a question or a window, or a resolution has no question,
an unknown kind, or a window that closes before it opens or has already closed.

The resolution's admin page shows its question, kind and window, the tally once it has closed, and
every ballot and the close with their fingerprints, above the roll.

### Entering a ballot for a member

Enter a ballot only for a member who [cannot cast one themselves](#casting-a-ballot), and only on
something in writing you can name.

1. Open the resolution and choose **Enter a ballot**.
2. Choose the member on the roll. Members who already have a ballot, cast by them or entered by
   staff, are not offered.
3. Choose for, against or abstain, record what you relied on, such as the reference of the signed
   proxy form, and choose **Record the ballot**.

Refused when voting has not opened or has closed, the member already has a ballot, or the
authority is blank.

### Publishing a dividend

Publish as above with the company's dividend notice as the document, choose **Dividend**, and fill
in, exactly as the instruction states them, the rate per share in AUD, the declaration date, the
payment date and the declared total; these fields stay blank for other kinds. If the total is
refused, do not change either figure: go back to the company, because one of them is wrong
([refusals](#the-rate-and-the-declared-total)).

The dividend's admin page shows the rate, the dates, the declared total and the undistributed
amount, each member's entitlement on the roll, and the payment records in order with their
fingerprints.

### Recording a payment

Record a payment only on the company's written advice that it has paid a member, with its
remittance evidence.

1. Open the dividend and choose **Record a payment**.
2. Choose the member on the roll. Only members owed at least a cent with no standing record are
   offered, each with their shares and entitlement.
3. Enter the date the company says it paid, the company's payment reference, the remittance evidence
   as a PDF, PNG or JPEG, and what you relied on, such as the reference of the company's payment
   advice. Choose **Record the payment**.

The record names you. Refused when the date is in the future or before the dividend was declared,
the reference or what you relied on is blank, or the evidence is not an accepted file.

### Withdrawing a payment record

Withdraw a record only on the company's written correction: a payment recorded against the wrong
member, on the wrong date or with the wrong reference, or one the company says did not go through.

1. Open the dividend and choose **Withdraw a payment record**.
2. Choose the member (only members whose latest record is a payment are offered), record why, such
   as the reference of the company's correction, and choose **Withdraw the record**.

After a withdrawal and a new record, the member sees the new record in place of the old.

### Opening a published document

Open a publication and choose **Open the published document**. It downloads, and each read is
recorded once in **Admin → Shareholder publications → Publication reads**. To confirm a file is the
one published, compare its SHA-256 (for example with `sha256sum`) with the publication's digest.

On a dividend's page, **Open the remittance evidence** beside each payment record downloads that
evidence (needing both view permissions), shows its SHA-256 on the same row, and is recorded in
**Publication reads** with the payment record named.

To check that a roll, a resolution's ballots or a dividend's payment records have not been altered,
see [verifying stored records](../operations/recovery.md#verifying-stored-records).

## The Published page

**Published to your members**, at `/company/publications` on web (**Documents → Published** in the
sidebar), is the company owner's
read-only view of the selected owned company's publications, newest first, in one **Publications**
card whose title carries the complete count; the web loads older ones on request. Each shows its
title, kind, the company and class names as frozen,
the record date and when it was published, and opens the stored document. A resolution adds its
question, kind, basis, window and status and, once closed, whether it was carried, the shares for,
against and abstaining, the eligible shares and turnout. A dividend adds its rate, declaration date
and payment date. There are no ballot or publishing controls.

## The Notices page

**Notices** (at `/publications` on web, and on its own page on mobile, opened from a notice
notification) lists, newest first,
what was published to the signed-in person as a member, with older items loaded on request. Each
notice shows its title, company, class, kind and record date, and opens the stored document. A
resolution shows the question, the basis, the person's votes, the window and, while voting is
open, the ballot choices; afterwards it shows the person's ballot and the result. A dividend shows
the declared rate, the payment date, the person's entitlement and what the company has recorded.

What waits on the person as a member is counted by the API's publication summary, which no page
shows since the wallet pages were removed ([#1452](https://github.com/Ledova/ledova/issues/1452)): open resolutions on which one of
their holdings has no ballot, with the soonest close, and dividends on which a holding owed at least
a cent has no standing payment record. A person on a roll twice waits until each holding is settled,
and a withdrawn record makes a holding wait again. Only the person's own roll rows count, so a
company owner who is not a member counts nothing.

Next: [member records and register outputs](member-records.md),
[the register of members](register.md) and
[publication records](../engineering/records.md#publications).
