# Planned: offerings and applications

[Business processes](README.md) · [Documentation](../README.md)

Offerings are planned for a later release and are not part of the first one (owner, 29 October 2026,
[#1421](https://github.com/Ledova/ledova/issues/1421);
[decision](../decisions.md#offerings-deferred-from-the-first-release)). Their web and backend code
was removed under the same issue. This page keeps how they are expected to work and the decisions
behind them. The last complete implementation, web and backend, is at
[`c2b41da4`](https://github.com/Ledova/ledova/tree/c2b41da4d5c48928e30fd30802fec6326e8f6cfa); recover
from Git history rather than starting again. Capital arranged outside Ledova is recorded today as an
[external allotment](issuing-shares.md#external-investor-allotments).

Contents:

- [How it fits](#how-it-fits)
- [Listing the company in the directory](#listing-the-company-in-the-directory)
- [Creating and submitting an offering](#creating-and-submitting-an-offering)
- [Review, approval and closing](#review-approval-and-closing)
- [Offer documents](#offer-documents)
- [Withdrawing an offering](#withdrawing-an-offering)
- [Investor access and eligibility](#investor-access-and-eligibility)
- [Applying for shares](#applying-for-shares)
- [Acceptance and the payment instruction](#acceptance-and-the-payment-instruction)
- [Payments, refunds and scale-back](#payments-refunds-and-scale-back)
- [Company paid issues](#company-paid-issues)
- [When each step happened](#when-each-step-happened)
- [The web pages](#the-web-pages)
- [Implementation notes](#implementation-notes)
- [Decisions and open questions](#decisions-and-open-questions)

## How it fits

An offering invites eligible investors to apply for new shares in one deployed class. The company
owner creates, edits, submits, withdraws and deletes offerings and reads their applications;
attaching documents also needs current company administration. In the last implementation platform
staff reviewed, approved, rejected and closed offerings in admin, accepted applications, confirmed
payments and recorded refunds on the company's instruction, and payment instructions used the
operator's settings, because company-run offering decisions and integrated payments were deferred
([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)). Staff
powers to take a company down stay separate from this routine review.

## Listing the company in the directory

Under Investor directory on the Offerings page, someone with current company administration turns on
Show this company to eligible investors; it is off by default, and only an active company can be
listed. The directory shows the share classes of active companies that are switched on, so a
compliance warning, suspension or delisting by [staff](companies.md#staff-registry-controls) hides a
company without changing the switch, and resolving the warning or reinstating lists it again. Turning
it off hides the company's classes but does not withdraw an offering under review.

## Creating and submitting an offering

An offering names one deployed class and sets:

- the price per share, in AUD ([decision](../decisions.md#the-signed-in-app));
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

## Review, approval and closing

The reviewer starts the review, approves, rejects with a reason, or closes an approved offering.
Approval checks the cap against the authorised shares again, because an issue may have completed
since submission. The reviewer cannot change the class, exemption, price, bounds, rails or window of
an offering past draft; only the company changes them, by editing after a rejection. The documents
are not fixed.

An offering is open while it is approved and the time is within its window. Nothing opens or closes
it automatically: reaching the cap does not close it, and closing is a deliberate act. Investors see
only open offerings in the directory; approval publishes the terms of an offering invisible to them
while submitted or under review.

## Offer documents

The company keeps its documents under **Eligibility → Supporting**
([company information and documents](companies.md#company-information-and-documents)). The offering
form lists only the offer types: prospectus or information memorandum, risk disclosure, business
plan, financial statements, auditor report, constitution and shareholder agreement. Personal records
such as the share register or a director's identification are never one click from investors.

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

## Withdrawing an offering

The company can withdraw a draft, submitted, under-review or rejected offering. Withdrawal keeps the
reviewer, review time, notes and any rejection reason, which the page shows as the previous
rejection; the offering stays visible as a record and can no longer be edited, resubmitted or
deleted.

## Investor access and eligibility

Investors reach offerings through the directory, which a company's own
[eligibility decision](participants.md#company-eligibility-decisions) opens, for that company only.
In the last implementation:

- an account first had to be ready to invest: an investing account with an active login, a verified
  email and [good standing](participants.md#account-standing). The Verification page showed
  **Account ready** or **Account checks needed** with the reasons, and readiness opened nothing by
  itself;
- a general decision (accountant's certificate or professional investor) and an associated-person
  decision both opened that company's directory entries, the "primary" purpose of a decision. An
  **associated-person** source (s708(12): proof of the person's role with the named company, such
  as an ASIC extract naming them) named its company by the identifier the company supplied, only an
  active company was accepted, and the lookup revealed nothing about the company; its decision bound
  that exact company;
- a **large-investment** source (s708(8)(a): at least AUD 500,000 payable on acceptance for an
  approved offering, such as a bank statement) supported a product-value decision. The participant
  entered the approved offering's identifier, which the company copied from the offering's page, and
  a whole-share quantity; the preview showed the share class, price, currency, amount and exact
  terms. The decision bound that offering, quantity, AUD amount and terms, reached at least
  AUD 500,000 and opened only that offering.

Eligibility is checked when a draft application is made, on submission and on acceptance, because a
decision can lapse in between. The operator's bank and stablecoin payment details were shown only to
platform staff and to people holding a current general decision from at least one company.

## Applying for shares

An investor whose current decision admits them chooses Apply for shares on an open offering, with a
whole number of shares and one of their verified wallets on Base to receive them, at least the
minimum and at most the maximum per investor and the cap. The draft holds the offering's price,
currency, company and class names, which later changes to the offering do not alter, and its total is
worked out in whole cents; it sends no payment. The investor then chooses Submit for review on
Applications.

Submission is refused, and the draft kept, when the offering is no longer visible to the investor.
The investor's reads, payment instruction and withdrawal stay available after a class is paused or
the company leaves the directory, is warned or is suspended. The investor can withdraw an
application while no money is held against it.

## Acceptance and the payment instruction

Accepting an application issues the payment instruction in the same step: a reference made of the
operator's prefix and an eight-character code, the amount, and either the operator's bank details or
its receiving wallet with the stablecoin, network and token contract. The investor's application
page shows it under Payment instruction. Payment is due by default seven days later, never after the
offering closes, and a daily job lapses an application past its due date with no payment recorded.

## Payments, refunds and scale-back

A recorded payment equal to the amount due makes the application Paid; more than due makes it Paid
with a refund owed; less than due leaves it awaiting payment unless the amount is accepted as final,
which reduces the shares to what was paid for, in whole shares, and records the rest as a refund
owed. A stablecoin payment needs the transfer's transaction hash, and one transfer can fund only one
application; the last implementation did not check that transfer on chain, so staff were trusted
there. A bank statement line already recorded against another application gives a warning, not a
refusal. Every action is kept in the history, and restating a payment downwards warns.

An application with money held cannot be rejected or withdrawn until that money is refunded. A refund
takes an amount above zero and no more than can be returned: before allotment, everything received;
afterwards, only the excess no allotted share paid for. A refund is refused while the issue is being
executed, until it resolves. An application closes only when every cent is back.

When paid applications waiting for their issue ask for more than the offering's remaining cap, the
offering is scaled back: each is cut in proportion, rounding down to whole shares, and the money the
cut strands becomes a refund owed.

## Company paid issues

The company issues the shares for a Paid application itself. On the class's Chain actions page,
under Paid issues, the preparer chooses Prepare paid issue and a Paid application, whose proposal
captures the application, recipient, shares, price and payment facts (a partial receipt, a
scaled-back quantity and a refund owed stay distinct from the requested shares and a refund paid),
and adds the authority document, approving director, authority reference and reason; no new
eligibility decision, wallet nomination, member choice, grant terms or acceptance is needed. Then
Approve and Apply.

Preparation and approval admit nothing; applying admits the original mint. The issue must fit both
the offering's remaining cap and the authorised shares less those issued and still to be minted; the
cap is a disclosure limit, and scale-back decides paid quantities. Queued work stays refundable until
it starts, and refunding it cancels that issue for good. The mint, its finality, the application's
Allotted status, the wallet holding and the register entry are separate outcomes; the register
records the Issue once a [wallet link](register.md#linking-wallets-to-members) names the subscriber's
wallet. Each issue links back to the application that paid for it. Rejecting the proposal neither
refunds nor rejects the application. A class opened by an import cannot use this path.

Approvers and register readers can read proposals without seeing the wider financial records, and
company administration grants no access to them. Nothing here collects AUD or shows that AUD pricing
or a stablecoin is a direct AUD payment
([on-ramp and AUD decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)).

## When each step happened

Each application records when it was submitted, accepted, given its payment instruction, allotted,
refunded and closed by rejection or withdrawal, and the date the money arrived as recorded. The
application page lists these under History in step order, leaving out steps that were never stamped
rather than guessing.

## The web pages

- **Offerings** (company): every offering of the selected company the person owns, each naming its
  class, price per share, opening and any closing time and status and opening its own page, followed
  by Investor directory and What happens next. New offering needs a deployed class.
- **An offering's page:** Review (status, who submitted and reviewed it and when, any rejection or
  closing reason, with Withdraw, Delete and Submit for review as the status allows); Terms (with Edit
  while editable, and on an approved offering its **Offering ID** in full with **Copy offering ID**
  for large-investment requests); Documents for investors (Add documents once approved or closed);
  and Applications on an approved or closed offering, 25 at a time, searchable by investor name,
  wallet address or payment reference and filtered by status. Quantities above 2,147,483,647 are
  refused.
- **Directory** (investors): the share classes a participant may see, grouped by company with its
  industry and location and no registry search; each class shows its symbol, authorised and issued
  shares and its current offering (**Open for applications** with price and dates, or **No offering
  open**), followed by the documents of its approved offerings.
- **Applications** (investors): each application's recorded company, class, currency and payment
  instruction, even after Directory access ends; a recorded partial payment shows the amount
  outstanding.

## Implementation notes

How the last implementation worked, for whoever restores it; the code is at the commit above.

- **Listing** was `Company.is_open_to_investors`, an editable company field rather than a status, so
  suspension and reinstatement left it set.
- **Submission** locked the `ShareToken` row so two submissions for one class gave one submission
  and one refusal. Headroom was the authorised shares less completed supply less the caps of other
  live offerings, and a partial unique constraint kept one live offering per class. One transition
  function made every status change, sent one notification and re-ran the headroom check on
  approval; admin froze the economics past draft. There was no open status or scheduler: "open" was
  derived from approval and the window.
- **Documents** published through approved or closed offerings were read through the directory's
  own selector, so an ineligible investor, a hidden class and an unknown document all answered the
  same 404. A database guard refused deleting or re-pointing a document such an offering carried.
- **Applications** copied the price, currency and company and class names onto the row, so the
  applicant's reads, payment instruction and guarded withdrawal survived a hidden parent. Draft,
  submission and acceptance re-read the offering and rechecked eligibility before and after an
  admission lock.
- **Payment instructions** appended an eight-character Crockford base32 code to the operator's
  2-to-10-character reference prefix within an 18-character limit, retried on the unique index, and
  gave the operator's bank fields or receiving wallet. Payment facts were columns on the
  application, a stablecoin hash was unique ignoring case, and every financial action wrote an admin
  history entry.
- **Refunds and scale-back:** money held blocked rejection and withdrawal; a refund was capped at
  the money not backing allotted shares and cancelled queued issuance work before it started.
  Scale-back set the allotted quantity, leaving the difference as a refund owed.
- **Paid issues** consumed an applied company decision that admitted one private issuance execution
  linked to the application. Each had to fit both the offering's remaining headroom and the
  authorised shares less those issued and still to be minted. A daily job lapsed unpaid
  applications with no payment recorded, and a five-minute job moved a paid application to Allotted
  once its issue completed.
- **Eligibility** used one decision function with a purpose (primary or secondary) and an optional
  offering and quantity; a product-value request stored the offering, class, quantity, price, AUD
  amount and a digest of the offering's terms, rechecked at every use.
- **Row-level security** let an issuer read the accounts, wallets and profiles of people who applied
  to its own offerings, so the register could name an allotted holder, and let an applicant read
  the issuance request behind their application.

## Decisions and open questions

- The first offerings target wholesale and sophisticated investors under the s708 exemptions; the
  positions were taken without advice
  ([eligibility decision](../decisions.md#eligibility-and-ownership-records);
  [legal positions](../legal/positions.md#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief)).
  Sign-up still asks investors to confirm that share offerings here are wholesale only.
- Offer documents publish to anyone the directory admits, and once an offering is approved or closed
  they are added to and never removed (owner, 2 October 2026;
  [decision](../decisions.md#eligibility-and-ownership-records)).
- New offerings are priced in AUD only ([decision](../decisions.md#the-signed-in-app)).
- Approved offerings show their Offering ID in full, the one exception to short references, so
  investors can quote it in a large-investment request.
- Routine review and payment handling sat with platform staff because company-run offering decisions
  and integrated payments were deferred on
  [9 October](../decisions.md#essential-registry-and-development-workflow-priority); the secondary
  sales and AUD settlement expansion is
  [not planned](../decisions.md#registry-focus-and-cancelled-expansion-tickets). Before offerings
  return, decide who reviews them, how money is collected, verified, reconciled and refunded, and
  what the [regulatory pathway](../regulatory-pathway.md) requires.

Next: [ways to issue shares today](issuing-shares.md#ways-to-issue-shares) and
[participants and eligibility](participants.md).
