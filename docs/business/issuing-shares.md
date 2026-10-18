# Share classes and issuing shares

[Business processes](README.md) · [Documentation](../README.md)

How a company sets up its share classes and issues new shares in Ledova, and what is not built. It
is for company representatives, product owners, support staff and engineers learning the domain.
Terms follow the [product glossary](../product.md#terms-that-must-stay-distinct): an offering
invites eligible investors to apply for new shares, and an investor's application is a subscription.

Contents:

- [Share classes](#share-classes)
- [Ways to issue shares](#ways-to-issue-shares)
- [Grants to walletless members](#grants-to-walletless-members)
- [Employee awards and vesting](#employee-awards-and-vesting)
- [External investor allotments](#external-investor-allotments)
- [Non-paid chain grants](#non-paid-chain-grants)
- [Offerings](#offerings)
- [Applications, payments and paid issues](#applications-payments-and-paid-issues)
- [Retained issue instructions](#retained-issue-instructions)
- [What these flows do not cover](#what-these-flows-do-not-cover)
- [Splits and consolidations](#splits-and-consolidations)
- [Planned: tokenising an imported register](#planned-tokenising-an-imported-register)
- [The Offerings page](#the-offerings-page)

## Share classes

A share class is a company's equity instrument, with a name, a class code, a type (Ordinary,
Preference or Redeemable) and a configured share limit; shares are whole units in the register and on
chain. A class starts as a draft with no contract; once deployed it has one and can be paused. A
class opened by an import can be deployed only while empty and never takes a chain opening or chain
issue ([the register](register.md#the-register-and-the-companys-records)).

The class-creation API requires a current personal company administrator or preparer appointment,
rechecked under the company lock. Ownership or platform staff status alone supplies no authority.
Web and mobile [register setup](register.md#bringing-in-existing-records) lists companies from those
appointments, including a preparer who is not the owner. Company Settings keeps its administration
boundary, lists scoped register classes and lets a current personal administrator create a class.
Creation records no shares and no legal registration. The technical
limit is not statutory authorised capital; the class code and type do not define its economic rights.
Class codes are one to five letters, unique within the company, and may not reuse a
reserved asset symbol. Neither a company nor a class can be deleted through the app: a company that
should close is delisted, and a class is paused to stop transfers. Deployment, capital increases and
pausing are company decisions; earlier direct actions by the owner or platform staff are retired,
and their records stay readable. The register API can confirm a zero-issued opening for a genuinely
unopened draft class without a contract or former members. It creates no shareholder, holding or
ISSUE; a subsequent approved grant or investor allotment records the first shares. Both clients expose
this empty-opening choice through the same draft, review and confirmation as copied holdings
([register setup](register.md#bringing-in-existing-records)).

### Deploying an empty class

A company appointee can have Ledova's technical signer create the class's contract. Deployment
issues no shares, takes no payment and changes no holding.

1. On the class's Share class page, under Empty-class deployment, choose Prepare deployment. The
   proposal captures the class, its whole-share cap and identifier, the selected issuer address, the
   exact transaction and the register's state.
2. Review the snapshot, then Approve deployment and Apply deployment.

Applying means admitted, not deployed: the page shows admission, holds, a signed transaction
awaiting confirmation and the outcome separately, and a contract address alone does not show
completion. The issuer address is contract information, separate from the technical sender and any
future recipient.

Only a draft class of an active company can be deployed, once. A class with no register, or with an
opened register holding no shares, can be deployed; an unopened or unreadable register, or issued
shares, refuse it,
because deployment cannot mirror populated holdings. Deployment never resets an empty register or
creates a second opening, and while it is admitted the register cannot change, including imports and
corrections. Company share operations grant no crypto on-ramp purchase permission. How the signer
executes it is in [engineering](../engineering/chain.md#share-class-deployment).

### Raising the authorised shares

A company appointee can raise the authorised shares of a deployed class, including a paused one.

1. On the Share class page, under Company capital increases, give the additional whole shares and
   the new total, which must equal the current cap plus the addition (each from 1 to 2,147,483,647).
2. Give the purpose, the board resolution reference, any shareholder approval reference and the
   authority document.
3. Approve, then Apply.

Raising the cap mints no shares, changes no holding and approves no grant, allotment or payment; the
optional shareholder reference sets no approval threshold, and Ledova does not verify the
resolution. Applying admits the original change, complete only when that transaction succeeds on
chain with its cap-change event; a matching cap alone does not show that. Rejection also rejects the
original request. One increase at a time can be in progress, and the cap never goes below the shares
issued.

### Pausing and unpausing a class

A company appointee can pause a deployed class, which stops every movement of its shares on chain,
or unpause it: on the Share class page, under Company pause decisions, prepare the requested state
with a reason, an authority reference and the authority document, then Approve and Apply. Pausing
needs no eligibility decision, nomination, payment or issue, and changes neither the cap nor the
issued shares.

Approval or admitted work does not mean transfers have stopped or resumed: the page shows the
requested state and its outcome apart from the class's current state. If the class is already in the
requested state, the outcome is recorded as observed, with no transaction. A paused class keeps its
members, and publications still reach them.

## Ways to issue shares

| Path                                                       | Class                                    | Recipient                                      | Money                                              |
| ---------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| [Non-paid grant](#grants-to-walletless-members)            | Opened by an import, no contract         | A new or existing member with no linked wallet | None                                               |
| [Employee award, then grant](#employee-awards-and-vesting) | Opened by an import, no contract         | A member with no linked wallet                 | None; vesting is recorded first                    |
| [External allotment](#external-investor-allotments)        | Opened by an import, no contract         | A new or existing member with no linked wallet | Fully paid in AUD, receipt recorded by the company |
| [Non-paid chain grant](#non-paid-chain-grants)             | Deployed, register opened from the chain | A member's nominated, company-approved wallet  | None                                               |
| [Paid issue](#company-paid-issues)                         | Deployed                                 | The subscriber's wallet                        | A subscription recorded as Paid                    |

A grant on a class with no contract is a register entry only; a chain grant mints shares, and the
register records the issue once the mint is final.

### What each record changes

| Record                                                               | Effect on issued shares and holdings                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Copying existing records (the opening)                               | Sets the opening balance; it is never an issue                                                                                      |
| Employee award and vesting                                           | None: an award is a promised entitlement and vesting a company record                                                               |
| Investor agreement and receipt                                       | None on their own; applying the allotment makes the issue                                                                           |
| Any issue: grant, award-linked grant, allotment, chain or paid issue | Increases the issued shares and the recipient's holding once                                                                        |
| Transfer                                                             | Moves shares between members; the class's issued shares stay the same ([transfers](register.md#non-paid-transfers-between-members)) |
| Correction                                                           | Keeps the earlier entry and records an exact reversal or opening difference ([corrections](register.md#compensating-corrections))   |

Investor and employee issues use the same register: one member, one set of holdings and one history
serve both.

### Rules every issue follows

Each path is a [company decision](README.md#how-a-company-decision-works); in addition:

- Every grant, allotment and paid issue names an approving director
  ([named directors](README.md#named-directors)).
- The register entry is dated the day the issue is recorded, in UTC; a terms, agreement, vesting or
  receipt date the company supplies is kept beside it and never backdates the entry, a publication
  roll or a certificate deadline.
- The issue must fit within the authorised shares; quantities are whole, and a chain request is at
  most 2,147,483,647.
- A payment or receipt never authorises an issue, and non-paid terms never create an amount paid.
- Proposals, their documents and history are read only within current company register authority; a
  publication roll already frozen keeps the recipients it recorded.
- The company remains responsible for its
  [ASIC notifications](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/company-share-issues)
  and for executing and delivering [certificates](member-records.md#certificates).

## Grants to walletless members

A non-paid grant records a company-authorised issue as an Issue entry, with no application, payment,
wallet or chain transaction.

1. Under Employee awards, open the class's Non-paid share issues and choose Prepare a non-paid
   grant, or choose Issue vested shares on an award.
2. Choose an existing member, or give a new member's name and residential address; names never link
   an account.
3. Give the shares, the date of the terms, the non-paid terms, the approving director, the authority
   reference and the reason, and upload the authority document, the terms document and any
   acceptance the terms require.
4. Approve the preview, then choose Record issue.

Applying checks the authority, evidence, identity, director, register and authorised shares again (a
lapsed approval needs a new one), and records one Issue entry with, for a new member, the member and
their particulars. The recipient must have no linked wallet anywhere in the company; a member with
one receives shares through a [chain grant](#non-paid-chain-grants). The member can then be invited
to read their own holding ([member access](member-records.md#member-access)). The issue list shows
the recipient, quantity, stage and next action, with particulars, documents and decision history in
the details.

## Employee awards and vesting

An employee award records a promised entitlement: the agreement, recipient, class, whole quantity
and vesting schedule. The company records each vesting event itself; the schedule is kept as text,
and a date passing creates no vesting, approval, issue or holding. Shares reach the register only
through a separate approved grant that references the award.

Each award shows four quantities, and the web chart separates unvested, vested but unissued and
issued shares:

| Quantity                  | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ |
| Promised                  | The whole quantity in the award agreement                    |
| Company-recorded vested   | The sum of the recorded vesting events                       |
| Issued through grants     | Shares actually issued by applied grants linked to the award |
| Vested and not yet issued | Recorded vesting less those issues                           |

1. Choose Employee awards, then Record an employee award on the class. Choose a new or existing
   recipient and give the promised shares, the agreement date and terms, the recorded vesting
   schedule and the agreement document. An award creates no member, entry, holding, issued share or
   certificate entitlement; a new recipient keeps the member ID their first grant will use.
2. Choose Record vesting on the award for a company-confirmed event with its shares, date and
   evidence. Dates are no later than today (UTC), an event cannot predate the agreement, and total
   vesting cannot exceed the promise.
3. When vested shares are available, choose Issue vested shares. The grant form opens with the
   recipient and available quantity, bound to the award's class, recipient and agreement; upload the
   matching agreement and the authority document, name the approving director and add any required
   acceptance. Preparing returns to Employee awards with the class's Non-paid share issues open;
   approve, then choose Record issue.

Applying rechecks the authority, evidence, vested quantity still available, particulars, register
and authorised shares, then records the Issue once. Pending or approved grants reserve neither
vested nor authorised shares, and a later transfer or correction returns no shares to the award.
Later grants use the recipient's existing member record, including a former-member record.

Recording awards and vesting is a [one-step action](README.md#how-a-company-decision-works); issuing
follows the grant's rules. Award, vesting and award-linked grant records and their documents are
read only through a current appointment holding administration or a register capability, and are
kept unchanged with their original actor, appointment and time. Employees read their own records
through [member access](member-records.md#member-access). Not built: restrictions or forfeiture on
issued shares, exercise prices, employee purchases, payment receipts, tax calculation and tokenised
award fulfilment.

## External investor allotments

A company records an investment it arranged outside Ledova and the fully paid allotment it approves.
No deployment, application, payment or chain receipt is involved.

1. On Register, choose Record investor share issue and the class, then Prepare an external
   allotment.
2. Person and shares: choose a member or record a new investor's particulars, then give the shares
   and the full consideration in AUD.
3. Agreement and company receipt: give the external agreement reference, date, terms and document,
   and separately the amount received, the date and the receipt evidence.
4. Company authority and review: name the approving director and give the authority reference, the
   reason and the authority document.
5. Approve the exact allotment, then choose Record issue.

The amount received must equal the consideration, because only fully paid allotments are supported.
Approval is separate from the receipt, and applying records one Issue; the agreement, receipt,
decision and resulting ownership stay separate records, shown under Record details and documents.
Rejecting an allotment keeps its agreement and receipt and performs no refund. A receipt is shown as
attested by the company, not verified by Ledova. The register's amount paid then includes the
consideration ([amount paid](register.md#amount-paid-and-date-entered)).

Lists, details and the three documents need a current appointment that can read the company's
register; owners and
platform staff have no automatic access to these financial records. Accepted members read their own
resulting holdings and history, while the documents stay with the company. Not built: partly paid
allotments, calls, outstanding amounts, collection, payment providers and refunds
([roadmap](../roadmap.md#deferred)).

## Non-paid chain grants

A chain grant mints outright non-paid shares on a deployed class whose register was opened from the
chain; a class opened by an import cannot use it. It needs, separately:

- the participant's own nomination of the receiving wallet, with proof that they control it;
- a current general [eligibility decision](participants.md#kinds-of-decision) from this company;
- a time-limited [company approval](participants.md#wallet-nominations-and-company-wallet-approvals)
  of that wallet, applied on chain;
- a [wallet link](register.md#linking-wallets-to-members) from that wallet to the member, made
  before the first grant to a new or existing member.

On the Share class page, under Non-paid chain grants, choose Prepare non-paid grant, select the
member, their nomination and the company's approval, and give the shares, terms, approving director
and documents, including acceptance evidence where the terms require it. Then Approve and Apply.
Matching an address alone never identifies the approval or the member.

Applying admits the original mint; it creates no holding. The register records the Issue once the
mint is final, and until then the allocation keeps reserving authorised shares. If authority or the
source changes before signing, the work is held
([share issuances](../engineering/chain.md#share-issuances)). A chain grant creates no application,
receipt or amount paid.

## Offerings

An offering invites eligible investors to apply for new shares in one deployed class. Today the
company owner creates, edits, submits, withdraws and deletes offerings and reads their applications;
attaching documents also needs current company administration. Platform staff review, approve,
reject and close offerings in admin, and payment instructions use the operator's settings, because
offering decisions and integrated payments are deferred
([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)). Staff
powers to take a company down stay separate from this routine review.

### Listing the company in the directory

Under Investor Directory on the Offerings page, someone with current company administration turns on
Show this company to eligible investors; it is off by default, and only an active company can be
listed. The directory shows the share classes of active companies that are switched on, so
suspension hides a company without changing the switch and reinstatement lists it again. The admin
form changes the switch only for someone with company administration. Turning it off hides the
company's classes but does not withdraw an offering under review.

### Creating and submitting an offering

An offering names one deployed class and sets:

- the price per share, in AUD (an offering created before AUD pricing keeps the currency it was
  given, and its applications' amounts use that currency;
  [decision](../decisions.md#the-signed-in-app));
- minimum, target and cap in whole shares (minimum at most target, target at most cap) and an
  optional maximum per investor, no more than the cap;
- an opening time and an optional closing time after it;
- the exemption relied on: the AUD 500,000 minimum amount (s708(8)(a)), net assets or gross income
  certified by a qualified accountant (s708(8)(c)), a professional investor (s708(11)) or a
  wholesale client (s761G);
- the payment rails: bank transfer, approved stablecoins, or both;
- a summary, the use of proceeds and the offer documents to attach.

Submission is refused unless the class is deployed and the company active; the class has no other
live offering (submitted, under review or approved); the cap fits within the authorised shares less
the shares issued and the caps of other live offerings (raise the authorised shares first); each
stablecoin is available on the operator's receiving network; at least one rail is set; and, for the
s708(8)(a) exemption, the minimum shares at the price are worth at least AUD 500,000. The refusal
names any offering in flight; two tranches at once are not supported. Only a draft or rejected
offering can be edited or submitted (Submit for review, or Submit again after a rejection), and only
a draft can be deleted. Each status change notifies the company owner.

### Review, approval and closing

Platform staff start the review, approve, reject with a reason, or close an approved offering.
Approval checks the cap against the authorised shares again, because an issue may have completed
since submission. Staff cannot change the class, exemption, price, bounds, rails or window of an
offering past draft; only the company changes them, by editing after a rejection. The documents are
not fixed.

An offering is open while it is approved and the time is within its window. Nothing opens or closes
it automatically: reaching the cap does not close it, and closing is a deliberate staff act.
Investors see only open offerings in the directory; approval publishes the terms of an offering
invisible to them while submitted or under review.

### Offer documents

The company uploads offer documents under Company documents
([company information and documents](companies.md#company-information-and-documents)), and the
offering form lists only the offer types: prospectus or information memorandum, risk disclosure,
business plan, financial statements, auditor report, constitution and shareholder agreement.
Personal records such as the share register or a director's identification are never one click from
investors.

Approval publishes the attached documents to anyone the directory admits to the class, whether the
offering is upcoming, open, past its closing time or closed; drafts and submitted, under-review,
rejected and withdrawn offerings publish nothing. Each document is listed once, newest first, and
only a file of the class's own company is published, never an external link. Investors' reads are
not recorded.

While an offering is approved or closed, documents can be added with Add documents but never removed
([decision](../decisions.md#eligibility-and-ownership-records)), because investors may already have
read them; deleting a company document that such an offering carries is refused. On a draft or
rejected offering the attachments can be changed, and saving drops one no longer among the company's
documents.

### Withdrawing an offering

The company can withdraw a draft, submitted, under-review or rejected offering. Withdrawal keeps the
reviewer, review time, notes and any rejection reason, which the page shows as the previous
rejection; the offering stays visible as a record and can no longer be edited, resubmitted or
deleted.

## Applications, payments and paid issues

Platform staff accept applications, confirm payments and record refunds in admin on the company's
instruction; the payment rail, receipt verification, reconciliation and refund design are deferred
([#869](https://github.com/Ledova/ledova/issues/869)). Capital arranged outside Ledova is an
[external allotment](#external-investor-allotments), not an application.

### Applying for shares

An investor whose current [eligibility decision](participants.md#company-eligibility-decisions) from
the company admits them chooses Apply for shares on an open offering, with a whole number of shares
and one of their verified wallets on Base to receive them, at least the minimum and at most the
maximum per investor and the cap. The draft holds the offering's price, currency, company and class
names, which later changes to the offering do not alter; the investor then chooses Submit for review
on Applications.

Eligibility is checked when the draft is made, on submission and when staff accept it, because a
decision can lapse in between. Submission is refused, and the draft kept, when the offering is no
longer visible to the investor. The investor's reads, payment instruction and withdrawal stay
available after a class is paused or the company leaves the directory, is warned or is suspended.
The investor can withdraw an application while no money is held against it.

### Acceptance and the payment instruction

Staff choose Accept and issue instruction, which issues the payment instruction in the same step: a
reference made of the operator's prefix and an eight-character code, the amount, and either the
operator's bank details or its receiving wallet with the stablecoin, network and token contract. The
investor's application page shows it under Payment instruction. Payment is due by default seven days
later, never after the offering closes, and a daily job lapses an application past its due date with
no payment recorded.

### Payments, refunds and scale-back

Staff record a payment with Confirm payment. Received equal to the amount due makes the application
Paid; more than due makes it Paid with a refund owed; less than due leaves it awaiting payment
unless staff accept the amount as final, which reduces the shares to what was paid for, in whole
shares, and records the rest as a refund owed. A stablecoin payment needs the transfer's transaction
hash, and one transfer can fund only one application; Ledova does not check that transfer on chain,
so staff are trusted here. A bank statement line already recorded against another application gives
a warning, not a refusal. Every action is kept in the admin history, and restating a payment
downwards warns.

An application with money held cannot be rejected or withdrawn until that money is refunded. Record
refund takes an amount above zero and no more than can be returned: before allotment, everything
received; afterwards, only the excess no allotted share paid for. A refund is refused while the
issue is being executed, until it resolves. An application closes only when every cent is back.

When paid applications waiting for their issue ask for more than the offering's remaining cap, staff
scale the offering back: each is cut in proportion, rounding down to whole shares, and the money the
cut strands becomes a refund owed.

### Company paid issues

The company issues the shares for a Paid application itself. On the Share class page, under Company
paid issue decisions, the preparer chooses a Paid application, whose proposal captures the
application, recipient, shares, price and payment facts (a partial receipt, a scaled-back quantity
and a refund owed stay distinct from the requested shares and a refund paid), and adds the authority
document, approving director, authority reference and reason; no new eligibility decision, wallet
nomination, member choice, grant terms or acceptance is needed. Then Approve and Apply.

Preparation and approval admit nothing; applying admits the original mint. The issue must fit both
the offering's remaining cap and the authorised shares less those issued and still to be minted; the
cap is a disclosure limit, and scale-back decides paid quantities. Queued work stays refundable
until it starts, and refunding it cancels that issue for good. The mint, its finality, the
application's Allotted status, the wallet holding and the register entry are separate outcomes; the
register records the Issue once a [wallet link](register.md#linking-wallets-to-members) names the
subscriber's wallet. Each issue links back to the application that paid for it. Rejecting the
proposal neither refunds nor rejects the application. A class opened by an import cannot use this
path, and earlier paid records keep their original actors.

Approvers and register readers can read proposals without seeing the wider financial records, and
company administration grants no access to them. Staff approval of paid issues is retired; Retry
allotment in admin remains only to recover the company's original issue after a technical failure
([subscription recovery](../operations/recovery.md#subscriptions)). Nothing here collects AUD or
shows that AUD pricing or a stablecoin is a direct AUD payment
([on-ramp and AUD decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)).

### When each step happened

Each application records when it was submitted, accepted, given its payment instruction, allotted,
refunded and closed by rejection or withdrawal, and the date the money arrived as staff recorded it.
The application page lists these under History in step order; older applications leave out steps
that were never stamped rather than guessing.

## Retained issue instructions

Direct issues on a class on chain approved before issues became company-run that still wait for
register cover need a [retained director instruction](register.md#retained-director-instructions),
which the company owner submits and platform staff review.

## What these flows do not cover

The company and its advisers decide valuation, class rights, offers, consents, employee terms,
approvals, the actual issue and transfer dates and filings; Ledova records the facts supplied and the
exact effects authorised
([what stays with the company](README.md#what-ledova-does-and-what-stays-with-the-company)). A
class's code or type is a label and does not define the rights attached to its shares.

Not built: options and their exercise, shares issued upfront with restrictions or forfeiture, partly
paid allotments and calls, convertible instruments, buy-backs, redemptions and capital reductions,
[splits and consolidations](#splits-and-consolidations), class conversions or variations of class
rights, and transmission.

Current limits, each with follow-up work proposed under the share lifecycle review
([#1060](https://github.com/Ledova/ledova/issues/1060)):

- An issue or transfer is dated the day it is recorded rather than the company's effective date, and
  the investor issue review shows the holdings and issued shares before and after but no implied
  price per share or ownership percentages. Proposed under [#1062](https://github.com/Ledova/ledova/issues/1062).
- An award-linked grant asks for its agreement again, and an award's unissued entitlement cannot be
  ended or corrected. Proposed under [#1063](https://github.com/Ledova/ledova/issues/1063).
- Joint, corporate and trust holdings have no separate structure: a member is one name and
  residential address, with the beneficial status the company records.

## Splits and consolidations

Not built. A split multiplies every holding in a class by one ratio; a consolidation divides them.
Neither moves value between members or changes anyone's proportion, but both change the issued
shares and so meet the authorised cap. The design lives in
[#649](https://github.com/Ledova/ledova/issues/649), any implementation belongs to a later issue,
and the 9 October scope excludes it ([decision](../decisions.md#splits-and-consolidations)). A later
implementation would be prepared and approved by company appointees, and company authority cannot
replace holder signatures where the contract requires them.

Shares are whole units at every layer, with no fraction to round into and no cash rail to pay one
out, so a remainder cannot be recorded, and no [register entry](register.md#register-entries) can
cancel part of a holding on a register in use. A split could be carried out only as one issue per
holder after a capital increase; a consolidation cannot be carried out at all, because nothing but
the holder can destroy shares
([why](../engineering/chain.md#why-splits-and-consolidations-cannot-run-on-a-live-class)).

## Planned: tokenising an imported register

No open issue owns this; it is [deferred](../roadmap.md#deferred). Deploying a class creates an
empty contract, not a mirror of its register, so neither a deployment nor a chain balance shows that
existing holdings are mirrored. A future mirror must capture one exact register entry and the member
holdings under current company authority, give every mapped wallet a company-approved member link,
represent the existing shares without a second Issue entry or more issued shares, and reconcile each
mapped holding against final chain evidence before claiming a mirror.

## The Offerings page

Offerings, under More in the web sidebar and in the mobile app, lists every offering of the selected
company the person owns, with its applications, followed by Investor Directory and What happens
next. Each offering shows its terms, status, any rejection, previous rejection or closing reason,
and the actions its status allows. New offering needs a deployed class; without one the page says to
deploy a class first.

The offering form checks the price, ordered bounds, dates and available settlement choices before
sending, sets the window in the device's local time on mobile, requires a settlement asset that is
no longer available to be removed explicitly, and keeps an edited offering's attachments until one
is switched off. Quantities above 2,147,483,647 are refused. On an approved or closed offering, Add
documents shows the attached documents ticked and locked and sends only new choices; if the offering
has since left approved or closed, the dialog says so and sends nothing.

Applications shows each application's requested and allotted shares, including zero allotments, as a
read-only record; the company's paid issues are on the Share class page
([company paid issues](#company-paid-issues)).

Next: [register of members](register.md), [member records and register outputs](member-records.md),
[participants and eligibility](participants.md) and
[offering and subscription mechanics](../engineering/backend.md#offerings-and-subscriptions).
