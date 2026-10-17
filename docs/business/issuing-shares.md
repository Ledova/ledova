# Share classes and issuing shares

[Business processes](README.md) · [Documentation](../README.md)

How a company sets up its share classes and issues new shares in Ledova: grants, employee awards,
externally arranged capital, chain grants, offerings with investor applications and paid issues, and
what is not built. It is for company representatives, product owners, support staff and engineers
learning the domain. The register the issues land on is described in
[register of members](register.md).

Contents:

- [Terms used here](#terms-used-here)
- [Share classes](#share-classes)
- [Ways to issue shares](#ways-to-issue-shares)
- [Grants to walletless members](#grants-to-walletless-members)
- [Employee awards and vesting](#employee-awards-and-vesting)
- [External investor allotments](#external-investor-allotments)
- [Non-paid chain grants](#non-paid-chain-grants)
- [Offerings](#offerings)
- [Applications, payments and paid issues](#applications-payments-and-paid-issues)
- [Retained issue instructions](#retained-issue-instructions)
- [Splits and consolidations](#splits-and-consolidations)
- [Planned: tokenising an imported register](#planned-tokenising-an-imported-register)
- [The Offerings page](#the-offerings-page)

## Terms used here

Terms follow the [product glossary](../product.md#terms-that-must-stay-distinct). An offering
invites eligible investors to apply for new shares; an investor's application is a subscription.

## Share classes

A share class is a company's equity instrument, with a name, a class code, a type (Ordinary,
Preference or Redeemable) and authorised shares. Shares are whole units in the register and on
chain. A class starts as a draft with no contract. A class opened by an import with holdings stays
without one; an empty imported register can be deployed, but it still cannot be opened from the
chain or take chain issues ([deploying an empty class](#deploying-an-empty-class)). A class with a
contract is deployed, and can be paused.

Only the company owner creates a class, with Create share class on the Company page or in register
setup ([bringing in existing records](register.md#bringing-in-existing-records)).
Creating a class creates no shares, and deployment and issuance are separate steps. Class codes are
one to five letters, unique within the company, and may not reuse a reserved asset symbol. Neither a
company nor a class can be deleted through the app: a company that should close is delisted, and a
class is paused to stop transfers.

### Deploying an empty class

A company appointee can have Ledova's technical signer create the class's contract. Deployment
issues no shares, takes no payment and changes no holding.

1. On the class's Share class page, under Empty-class deployment, choose Prepare deployment. The
   proposal captures the company and class information, the whole-share cap and identifier, the
   selected issuer address, the exact transaction intent and the register's state.
2. Review the snapshot, then Approve deployment and Apply deployment.

Applying means admitted, not deployed. The page shows admission, holds, a signed transaction
awaiting confirmation and the final outcome separately; a contract address alone does not show that
the deployment completed. The issuer address is contract information, separate from the technical
sender and any future recipient.

Only a draft class of an active company can be deployed, once. A class with no register, or with an
opened register holding no shares, can be deployed; an unopened register or issued shares refuse it,
because deployment cannot mirror populated holdings. Deployment never resets an existing empty
register or creates a second opening. While a deployment is admitted, the register cannot change,
including imports and corrections, until it completes. A class opened by an import, even one with no
holdings, cannot be opened from the chain after deployment and cannot use chain issues. Company
share operations grant no crypto on-ramp purchase permission. Direct deployment by the owner or
platform staff is retired; earlier records keep their history. How the signer executes it is in
[engineering](../engineering/chain.md#share-class-deployment).

### Raising the authorised shares

A company appointee can raise the authorised shares of a deployed class, including a paused one.

1. On the Share class page, under Company capital increases, prepare the increase: the additional
   whole shares and the new total, which must equal the current cap plus the addition (each from 1
   to 2,147,483,647).
2. Give the purpose, the board resolution reference, any shareholder approval reference and the
   company's authority document.
3. Approve, then Apply.

Raising the cap mints no shares and changes no holding. It approves no grant, allotment or payment,
and the optional shareholder reference sets no new approval threshold. Ledova does not verify the
resolution. Applying admits the original change. It is complete only when that original transaction
succeeds on chain with its cap-change event; a matching cap alone does not show that. Rejection also
rejects the original request. Another increase cannot be prepared while one is in progress, and the
cap can never go below the shares already issued. Direct capital requests by the owner or staff are
retired.

### Pausing and unpausing a class

A company appointee can pause a deployed class, which stops every movement of its shares on chain,
or unpause a paused one. On the Share class page, under Company pause decisions, prepare the
requested state with a reason, an authority reference and the authority document, then Approve and
Apply. Pausing needs no eligibility decision, nomination, payment or issue, and changes neither the
cap nor the issued shares.

Approval or admitted work does not mean transfers have stopped or resumed. The page shows the
requested state and its outcome separately from the class's current state. If the class is already
in the requested state, the outcome is recorded as observed, with no transaction. Direct pause
actions by the owner or staff are retired; earlier records stay readable. A paused class keeps its
members, and publications still reach them.

## Ways to issue shares

Which path a company uses depends on whether the class has a contract.

| Path                                                                                     | Class                                                   | Recipient                                       | Money                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| [Non-paid grant](#grants-to-walletless-members)          | Opened by an import, no contract                        | A new or existing member with no linked wallet  | None                                         |
| [Employee award, then grant](#employee-awards-and-vesting) | Opened by an import, no contract                      | A member with no linked wallet                  | None; vesting is recorded first              |
| [External allotment](#external-investor-allotments)      | Opened by an import, no contract                        | A new or existing member with no linked wallet  | Fully paid in AUD, receipt recorded by the company |
| [Non-paid chain grant](#non-paid-chain-grants)           | Deployed, register opened from the chain                | A member's nominated, company-approved wallet   | None                                         |
| [Paid issue](#company-paid-issues)                       | Deployed                                                | The subscriber's wallet                         | A subscription recorded as Paid              |

Two kinds of non-paid grant exist. A grant on a class with no contract is a register entry only; a
chain grant mints shares on a deployed class and the register records the issue once the mint is
final. Neither can be used on the other kind of class.

### Rules every issue follows

Each path is a [company decision](README.md#how-a-company-decision-works); in addition:

- Every grant, allotment and paid issue names the approving director, who cannot be the recipient
  ([named directors](README.md#how-a-company-decision-works)).
- The register entry is dated the actual day the issue is recorded, in UTC. A terms, agreement,
  vesting or receipt date the company supplies is kept beside it and never backdates the entry, a
  publication roll or a certificate deadline.
- The issue must fit within the class's authorised shares. Quantities are whole shares, and a chain
  request is at most 2,147,483,647.
- A payment or receipt never authorises an issue, and non-paid terms never create an amount paid.
- Proposals, their documents and history are read only within current company register authority. A
  publication roll already frozen keeps the recipients it recorded.
- After an issue the company remains responsible for its
  [ASIC notifications](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/company-share-issues)
  and for executing and delivering certificates; Ledova's
  [certificates](member-records.md#certificates) are unsigned, and it lodges nothing.

## Grants to walletless members

A non-paid grant records a company-authorised issue on a register that an import opened, for a class
with no contract. It creates an Issue entry and no application, payment, wallet or chain
transaction.

1. Under Employee awards, open the class's Non-paid share issues and choose Prepare a non-paid
   grant, or choose Issue vested shares on an award.
2. Choose an existing member, or give a new member's name and residential address. Names never link
   an account or merge members.
3. Give the shares to grant, the date of the terms, the non-paid terms, the approving director, the
   company authority reference and the reason. Upload the authority document and the terms document,
   and, if the terms require the recipient's acceptance, the acceptance document.
4. Approve the preview, which shows the member, director, terms, quantity, terms date, the actual
   entry day, current holdings, issued and authorised shares and the resulting totals. Then choose
   Record issue.

Applying checks the authority, evidence, identity, director, register and authorised shares again; a
lapsed approval needs a new approval. It records one Issue entry and, for a new member, the member
and their particulars at the same time. The recipient must have no linked wallet anywhere in the
company; a member with a linked wallet receives shares through a
[chain grant](#non-paid-chain-grants) on a deployed class. The
register and its outputs show an unrecorded amount paid. The member can then be invited to read
their own holding ([member access](member-records.md#member-access)). The
issue list shows the recipient, quantity, stage and next action, with particulars, documents and
decision history in the details.

## Employee awards and vesting

An employee award records a promised entitlement: the agreement, recipient, class, whole quantity
and vesting schedule. The company then records each vesting event. The schedule is kept as text and
Ledova does not calculate vesting from it: a date passing creates no vesting, approval, issue or
holding. Shares reach the register only through a separate approved grant that references the award.
Awards are recorded on a register an import opened, for a class with no contract, and the recipient
has no linked wallet.

Each award shows four quantities, and the web chart separates unvested, vested but unissued and
issued shares:

| Quantity                   | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------ |
| Promised                   | The whole quantity in the award agreement                    |
| Company-recorded vested    | The sum of the recorded vesting events                       |
| Issued through grants      | Shares actually issued by applied grants linked to the award |
| Vested and not yet issued  | Recorded vesting less those issues                           |

1. Choose Employee awards, then Record an employee award on the class. Choose a new or existing
   recipient, and give the promised shares, the agreement date and terms, the recorded vesting
   schedule and the agreement document. Recording an award creates no member, entry, holding, issued
   share or certificate entitlement; a new recipient keeps the member ID their first grant will use.
2. Choose Record vesting on the award to record a company-confirmed event with its shares, date and
   evidence. Dates are no later than today (UTC), an event cannot predate the agreement, and total
   vesting cannot exceed the promise.
3. When vested shares are available, choose Issue vested shares. The grant form opens with the
   recipient and available quantity, bound to the award's class, recipient and agreement. Upload the
   matching agreement and the grant's authority document, name the approving director and add any
   required acceptance. Preparing returns to the same company's Employee awards with the class's
   Non-paid share issues open; approve, then choose Record issue.

Applying checks the company's authority, evidence, the vested quantity still available, the member's
particulars, the register and the authorised shares again, then records the Issue once. Pending or
approved grants reserve neither vested shares nor authorised shares, and a later transfer or
correction does not return shares to the award. After the first issue, later grants use the
recipient's existing member record, including a former-member record.

Recording awards and vesting needs administration or prepare
([company capabilities](README.md#company-capabilities)); issuing keeps the grant's approval,
application and director rules. Award, vesting and award-linked grant
records and their documents are read only by a current appointment for the company that holds
administration or a register capability. Awards and vesting events are kept unchanged with their
original actor, appointment and time. Not built: restrictions or forfeiture on issued shares,
exercise prices, employee purchases, payment receipts, tax calculation and tokenised award
fulfilment. Employees read their own records through
[member access](member-records.md#member-access).

## External investor allotments

A company records an investment it arranged outside Ledova and the fully paid allotment it approves.
The investor can be a new or existing member with no linked wallet. No deployment, application,
payment or chain receipt is involved, and Ledova neither collects nor verifies the money.

1. On Register, open the class's External investor allotments and choose Prepare an external
   allotment.
2. Person and shares: choose a member, or record a new investor's particulars, then the shares to
   allot and the full consideration in AUD.
3. Agreement and company receipt: give the external agreement reference, date, terms and document.
   Separately record the amount the company received, the date and the receipt evidence.
4. Company authority and review: name the approving director and give the authority reference, the
   reason and the authority document.
5. Approve the exact allotment, then choose Record issue. The preview shows the recipient's holding
   and issued shares before and after.

The amount received must equal the consideration, because only fully paid allotments are supported.
Preparing creates no holding. Approval is separate from the company's receipt, and applying records
one Issue. The agreement, receipt, decision and resulting ownership stay separate records, and
Record details and documents shows each. Rejecting an allotment keeps its agreement and receipt and
performs no refund. A receipt is shown as attested by the company: it grants no authority to issue
and is not Ledova verification. The register's Amount paid then includes the consideration
([amount paid](register.md#amount-paid-and-date-entered)).

Lists, details and the three documents need a current appointment for the company; owners and
platform staff have no automatic access to these financial records. Accepted members read their own
resulting holdings and history, and the agreement, receipt and authority documents stay with the
company. Not built: partly paid allotments, calls, outstanding amounts, collection, payment
providers and refunds ([roadmap](../roadmap.md#deferred)). Employee awards and non-paid grants
stay distinct from paid investor capital.

## Non-paid chain grants

A chain grant mints outright non-paid shares on a deployed class whose register was opened from the
chain. A class opened by an import cannot use it, even after deployment. Several facts are needed,
each separately:

- the participant's own nomination of the receiving wallet, with proof that they control it;
- a current general
  [eligibility decision](participants.md#kinds-of-decision)
  from this company;
- a time-limited
  [company approval](participants.md#wallet-nominations-and-company-wallet-approvals) of that
  wallet, applied on chain;
- a [wallet link](register.md#linking-wallets-to-members) from that wallet to the
  member, made before the first grant to a new or existing member.

On the Share class page, under Non-paid chain grants, choose Prepare non-paid grant, select the
member, their nomination and the company's approval, and give the shares, terms, approving director
and documents, including acceptance evidence where the terms require it. Then Approve and Apply.
Matching an address alone never identifies the approval or the member.

Applying admits the original mint; it does not create a holding. The register records the Issue once
the mint is final, in the name of the person who applied it. Until then the allocation keeps
reserving authorised shares. If authority or the source changes before signing, the work is held
([share issuances](../engineering/chain.md#share-issuances)). A chain grant creates
no application or receipt and no amount paid.

## Offerings

An offering invites eligible investors to apply for new shares in one deployed class. Today the
company owner (the account that owns the company) creates, edits, submits, withdraws and deletes
offerings and reads their applications; attaching documents also needs current company
administration. Platform staff review, approve, reject and close offerings in admin, and payment
instructions use the operator's settings, because offering decisions and integrated payments are
deferred
([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)).
Staff powers to take a company down stay separate from this routine review.

### Listing the company in the directory

The company decides whether investors can find it. Under Investor Directory on the Offerings page,
someone with current company administration turns on Show this company to eligible investors. It is
off by default, and only an active company can be listed. The directory shows the share classes of
active companies that are switched on, so suspension hides a company without changing the switch,
and reinstatement lists it again. Platform staff have no separate switch: the admin form changes it
only for someone with company administration. Turning it off hides the company's classes; it does
not withdraw an offering under review.

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
s708(8)(a) exemption, the minimum shares at the price are worth at least AUD 500,000. A second
submission for a class is refused, naming the offering in flight; two tranches at once are not
supported. Only a draft or rejected offering can be edited or submitted (Submit for review, or
Submit again after a rejection), and only a draft can be deleted. Each status change notifies the
company owner.

### Review, approval and closing

Platform staff start the review, approve, reject with a reason, or close an approved offering, in
admin only. Approval checks the cap against the authorised shares again, because an issue may have
completed since submission. Staff cannot change the class, exemption, price, bounds, rails or window
of an offering past draft, so the company's terms stay the single source of its economics; only the
company changes them, by editing after a rejection. The documents are not fixed.

An offering is open while it is approved and the time is within its window. Nothing opens or closes
it automatically: reaching the cap does not close it, and closing is a deliberate staff act.
Investors see only open offerings in the directory; a submitted or under-review offering is
invisible to them, and approval publishes its terms.

### Offer documents

The company uploads offer documents under Company documents
([company information and documents](companies.md#company-information-and-documents)), and the
offering form lists only the offer types: prospectus or information memorandum, risk disclosure,
business plan, financial statements, auditor report, constitution and shareholder agreement.
Personal records such as the share register or a director's identification are never one click
from investors.

Approval publishes the attached documents to anyone the directory admits to the class, whether the
offering is upcoming, open, past its closing time or closed. Drafts and submitted, under-review,
rejected and withdrawn offerings publish nothing. Each document is listed once, newest first, and
only a file of the class's own company is published, never an external link. Investors' reads of
company documents are not recorded.

While an offering is approved or closed, documents can be added with Add documents but never removed
(owner decision, 2 October 2026), because investors may already have read them; deleting a company
document that such an offering carries is refused. On a draft or rejected offering the attachments
can be changed, and saving drops one that is no longer among the company's documents.

### Withdrawing an offering

The company can withdraw a draft, submitted, under-review or rejected offering. Withdrawal keeps the
reviewer, review time, notes and any rejection reason, which the page shows as the previous
rejection; the offering stays visible as a record and can no longer be edited, resubmitted or
deleted.

## Applications, payments and paid issues

Platform staff accept applications, confirm payments and record refunds in admin on the company's
instruction; the payment rail, receipt verification, reconciliation and refund design are deferred
([#869](https://github.com/Ledova/ledova/issues/869)). Issuing the shares is a company decision. A
recorded receipt never approves an issue, and capital arranged outside Ledova is recorded as an
[external allotment](#external-investor-allotments), not an
application.

### Applying for shares

An investor whose current
[eligibility decision](participants.md#company-eligibility-decisions)
from the company admits them chooses Apply for shares on an open offering, with a whole number of
shares and one of their verified wallets on Base to receive them. The application must be at least
the minimum, at most the maximum per investor and at most the cap. It starts as a draft holding the
offering's price, currency, company and class names; later changes to the offering do not alter it.
The investor then chooses Submit for review on Applications.

Eligibility is checked when the draft is made, on submission and again when staff accept it, because
a decision can lapse in between. Submission is refused, and the draft kept, when the offering is no
longer visible to the investor. The investor's reads, payment instruction and withdrawal stay
available after a class is paused or the company leaves the directory, is warned or is suspended.
The investor can withdraw an application while no money is held against it.

### Acceptance and the payment instruction

Staff choose Accept and issue instruction, which issues the payment instruction in the same step: a
reference made of the operator's prefix and an eight-character code, the amount, and either the
operator's bank details or its receiving wallet with the stablecoin, network and token contract. The
investor's application page shows it under Payment instruction. Payment is due by default seven days
later, and never after the offering closes. A daily job lapses an application past its due date with
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
refund takes an amount above zero and no more than can be returned: before the shares are allotted,
everything received; afterwards, only the excess no allotted share paid for. A refund is refused
while the issue is being executed, until it resolves. An application closes only when every cent is
back.

When paid applications waiting for their issue ask for more than the offering's remaining cap, staff
scale the offering back: each application is cut in proportion, rounding down to whole shares, and
the money the cut strands becomes a refund owed.

### Company paid issues

The company issues the shares for a Paid application itself. On the Share class page, under Company
paid issue decisions, someone with administration or prepare chooses a Paid application. The
proposal captures the application, class, recipient, whole shares to allot, price, payment dates
and references, money held and refund facts; a partial receipt and a scaled-back quantity stay
distinct from the requested shares, and a refund owed stays distinct from a refund paid. The
preparer adds the company's authority document, the approving director, the authority reference
and the reason. No new eligibility decision, wallet nomination, member choice, grant terms or
acceptance is needed. Then Approve and Apply.

Preparation and approval admit nothing; applying admits the original mint. The issue must fit both
the offering's remaining cap and the class's authorised shares less those issued and still to be
minted; the cap is a disclosure limit, and scale-back decides paid quantities. Queued work stays
refundable until it starts, and refunding it cancels that issue for good. The mint, its finality,
the application's Allotted status, the wallet holding and the register entry are separate outcomes;
the register records the Issue once a
[wallet link](register.md#linking-wallets-to-members) names the subscriber's wallet,
and waits until then. Each issue links back to the application that paid for it. Rejecting the
proposal neither refunds nor rejects the application. A class opened by an import cannot use this
path. Earlier paid records keep their original actors.

Approvers and register readers can read proposals without seeing the wider financial records, and
company administration grants no access to them. Staff approval of paid issues is retired; Retry
allotment in admin remains only to recover the company's original issue after a technical failure
([subscription recovery](../operations/recovery.md#subscriptions)). Nothing here collects AUD or
shows that AUD pricing or a stablecoin is a direct AUD payment
([on-ramp and AUD decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)).

### When each step happened

Each application records when it was submitted, accepted, given its payment instruction, allotted,
refunded and closed by rejection or withdrawal, and the date the money arrived as staff recorded it.
The investor's application page lists these under History in step order; older applications leave
out steps that were never stamped rather than guessing.

## Retained issue instructions

New issues are company decisions. A retained instruction covers only direct issues on a class on
chain that were approved before issues became company-run and still wait for register cover
([why an issue waits](register.md#why-a-completed-effect-waits)). It follows the
owner's single register instruction decision of 22 September 2026
([the stored register](../decisions.md#the-stored-register)).

1. The company owner submits an instruction listing each retained issue by its request, recipient
   wallet and whole shares, naming the approving director, with the authority reference, a reason
   and a company document that platform staff have
   [verified](companies.md#staff-verification-of-a-company-document). Ledova keeps a private copy.
   It is submitted through Ledova's API
   ([retained instructions API](../engineering/records.md#retained-register-instructions-api));
   neither app has a form for it.
2. Platform staff open it under Register instructions in admin, inspect the retained document, the
   director, the reference and the company identity, check each item's exact terms and that the
   director is not a recipient, then confirm within 15 minutes and choose Approve and apply, or
   reject with a reason.

Each item must match its request's current recipient and shares, be an earlier approval still
awaiting cover and not be covered by another applied instruction. New grants and paid issues are
refused, as are a director who is a recipient and any class an import opened. Listing an approval
adds the cover its entry waits for without approving it again, and applying records any listed issue
that completed and was waiting. Earlier paid instructions stay as history and admit nothing new.
Staff can still reject retained review requests. Instructions are kept unchanged and cannot be
deleted ([retention](../engineering/security.md#retention-clocks)).

## Splits and consolidations

Not built. A split multiplies every holding in a class by one ratio; a consolidation divides them.
Neither moves value between members or changes anyone's proportion, but both change the issued
shares and so meet the authorised cap. The owner decided on 23 September 2026 that the design lives
in [#649](https://github.com/Ledova/ledova/issues/649) and any implementation belongs to a later
issue; the 9 October scope does not include it
([decision](../decisions.md#splits-and-consolidations)). A later implementation would be
prepared and approved by company appointees, and company authority cannot replace holder signatures
where the contract requires them.

Today shares are whole units at every layer, so there is no fraction to round into and no cash rail
to pay one out, and a corporate action that leaves a remainder cannot be recorded. No register entry
records a split: a cessation removes a whole holding, a transfer only moves shares to another
member, and a correction exactly reverses an earlier entry. Only a
[copied opening correction](register.md#correcting-the-copied-opening) records other differences,
and it is refused once the register has any later activity, so on a register in use nothing can
cancel part of a holding. A split could be carried out only as one issue per
holder after a capital increase; a consolidation cannot be carried out at all, because nothing but
the holder can destroy shares
([why](../engineering/chain.md#why-splits-and-consolidations-cannot-run-on-a-live-class)).

## Planned: tokenising an imported register

No open issue owns this; it is [deferred](../roadmap.md#deferred). Deploying a class creates an
empty contract, not a mirror of its register, so neither a deployment nor a chain balance shows that
existing holdings have been mirrored. A future mirror must capture one exact register entry and the
member holdings under current company authority, give every mapped wallet a company-approved member
link, represent the existing shares without a second Issue entry or more issued shares, and
reconcile each mapped holding against final chain evidence before claiming a mirror.

## The Offerings page

Offerings, under More in the web sidebar and in the mobile app, lists every offering of the selected
company the person owns, with its applications, followed by Investor Directory and What happens
next. Each offering shows its class, status, price per share, minimum, target and cap shares, any
maximum per investor, opening and closing times, the exemption and any rejection, previous rejection
or closing reason. Its actions are Submit for review or Submit again, Edit, Withdraw, Delete and Add
documents, as its status allows. New offering needs a deployed class; without one the page says to
deploy a class first.

The offering form checks the price, ordered bounds, dates and available settlement choices before
sending, sets the window in the device's local time on mobile, requires a settlement asset that is
no longer available to be removed explicitly, lists the company's uploaded offer documents and keeps
an edited offering's attachments until one is switched off. Quantities above 2,147,483,647 are
refused. On an approved or closed offering, Add documents shows the attached documents ticked and
locked and sends only new choices; if the offering has since left approved or closed, the dialog
says so and sends nothing.

Applications shows each application's requested and allotted shares, including zero allotments, as a
read-only record; the company's paid issues are on the Share class page
([company paid issues](#company-paid-issues)).

Next: [register of members](register.md),
[member records and register outputs](member-records.md),
[participants and eligibility](participants.md) and
[offering and subscription mechanics](../engineering/backend.md#offerings-and-subscriptions).
