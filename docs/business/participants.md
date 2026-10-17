# Investors, members and eligibility

[Business processes](README.md) · [Documentation](../README.md)

How people take part in Ledova: their accounts and identity checks, each company's own eligibility
decisions, wallet nominations and company wallet approvals, self-reported profile details and the
monitoring that runs on wallet transactions. It is written for investors, company approvers,
support and compliance staff, and engineers learning the domain. Members' access to their own
register records is in [member records](member-records.md).

- [Accounts and identity verification](#accounts-and-identity-verification)
- [Company eligibility decisions](#company-eligibility-decisions)
- [Wallet nominations and company wallet approvals](#wallet-nominations-and-company-wallet-approvals)
- [Member profile](#member-profile)
- [Transaction monitoring](#transaction-monitoring)
- [The Verification page](#the-verification-page)
- [The Directory page](#the-directory-page)
- [Profile and Settings](#profile-and-settings)

Three facts stay separate throughout: whether an account is ready to invest, whether a particular
company has accepted a participant as eligible, and whether that company has approved a wallet to
hold its shares. None of them implies another, and reusable evidence never approves investing in
every company ([eligibility decision](../decisions.md#eligibility-and-ownership-records)).

## Accounts and identity verification

### Investor signup

1. Create your account, verify your email and choose **Individual Investor** as the account type.
   Company representatives follow [company signup](companies.md#company-signup).
2. At **Eligibility Check**, confirm that you are over 18, an Australian resident and opening an
   individual account.
3. Complete identity verification with the configured provider, or choose **Skip for Now** and
   finish it later from Profile.
4. Complete your personal profile and financial profile, review them and choose **Complete
   Signup**, which accepts the Terms of Service and Privacy Policy.

An unfinished account can sign in again and resume. One account can hold both investing and
company roles; the role chooses navigation, never company authority.

### Account readiness

An account is Pending Verification, Active, Rejected, Suspended or Terminated. To invest, a person
needs an investing account with an active login and a verified email, in good standing:

- With the investor identity requirement on (the default), the account must be Active and the
  person's identity verified.
- With it off, a Pending Verification account is also ready and identity is not required.
- Rejected, Suspended and Terminated accounts are never ready.

The Verification page states the reasons an account is not ready. Readiness grants no access to
any company's offerings or market: each company decides that separately
([company eligibility decisions](#company-eligibility-decisions)).
The equivalent requirement for company representatives is separate
([representative identity requirement](companies.md#representative-identity-requirement)).

### Identity check results

The instance uses one configured identity provider, KYCAID or Sum&Sub; without one, identity
verification is unavailable
([provider configuration](../operations/configuration.md#identity-verification-providers)).
A result counts only once the provider reports the check as completed. A provisional answer, a
status poll that brings no result, or a status the provider does not document records nothing
final; the check stays pending. A KYCAID approval counts only once the person's politically exposed
person (PEP) flag is known to be yes or no. How each provider's statuses are read is under
[identity providers](../engineering/backend.md#when-a-result-counts).

When a check is approved, the person's identity becomes verified and the account policy runs once:

- the account is Rejected if the PEP rules below reject the person, or if their citizenship is on
  the FATF black list;
- otherwise the account becomes Active and a risk assessment is recorded.

When a check is declined or needs more information, the identity is not verified. If it had been
verified and the investor identity requirement is on, the person's company wallet approvals are
queued for removal ([when eligibility ends](#when-eligibility-ends)).
The person is notified when the result changes, and the notice opens Profile.

### PEP rules

- Foreign, international-organisation, family-member and close-associate PEPs are rejected, and
  KYCAID's yes-or-no PEP flag counts as a foreign PEP.
- A domestic PEP is accepted with a risk-score adjustment of two.
- When Sum&Sub approves a person whose screening shows a PEP match without a category, the risk
  assessment records "PEP category not provided" as provider-approved and applies the same
  adjustment of two. This is the owner's decision to respect the compliance officer's clearance
  while keeping the PEP risk weighting; Ledova neither invents a domestic category nor overturns the
  provider's approval. Any other uncleared PEP without a category is rejected.
- No sanctions rejection is overridden, and the FATF black-list rejection still applies.

### What applicants see

Applicants never see a screening reason. Where a decline reason reports a list match (PEP,
sanctions, compromised persons, adverse media, criminal, block list or restricted person), the
identity status and Profile show "UNABLE_TO_VERIFY" once in its place; every other reason is shown
as it is. The stored result keeps every reason, staff see them in admin, and identity notifications
name none.

After approval, KYCAID's ongoing database screening can report a match on a sanctions, PEP, wanted,
lost-or-stolen-document or internal list. Each new match raises one compliance alert for staff
review (critical for sanctions and wanted lists, high otherwise) and leaves the account, the
identity result and the risk assessment as they are.

## Company eligibility decisions

Eligibility is one company's decision about one participant. The participant shares a
classification source with one company and asks for its decision; a current company approver
accepts it with a bounded expiry or refuses it, and can later revoke it. A decision is per company:
another company's acceptance supplies no permission. It is also separate from the company's
on-chain wallet approval
([wallet nominations](#wallet-nominations-and-company-wallet-approvals)).
Staff classification review is retired; historical review fields remain as history.

### Evidence sources

The offers on this platform are made only to wholesale and sophisticated investors, not under a
disclosure document. A participant adds evidence for one of four categories on the Verification
page ([legal positions](../legal/positions.md#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief)):

| Category                           | Basis      | Evidence                                                                                      |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Large investment                   | s708(8)(a) | At least AUD 500,000 payable on acceptance for an approved offering, such as a bank statement |
| Qualified accountant's certificate | s708(8)(c) | A certificate issued in the last two years by a CA ANZ, CPA Australia or IPA member           |
| Professional investor              | s708(11)   | An AFS licence, a regulator registration, or proof of AUD 10 million under management         |
| Associated with the issuer         | s708(12)   | Proof of the person's role with the named company, such as an ASIC extract naming them        |

Each submission is its own source, and a person may hold several. An associated-person source names
its company by the identifier the company supplies, and only an active company is accepted; this
lookup reveals nothing about the company. A submitted source can be withdrawn. A company's
acceptance never marks a source as verified for anyone else. Sources verified under the retired
staff review show as Historical verification.

### Kinds of decision

- A general decision accepts an accountant-certificate or professional-investor source for the
  deciding company. It opens that company's directory entries and its market, and it is the
  decision that a wallet nomination, a non-paid chain grant and a company wallet approval require.
- An associated-person decision is primary eligibility for the exact company the claim names. It
  opens that company's directory entries but never its market.
- A product-value decision binds the exact approved offering, whole-share quantity, AUD amount and
  terms; the amount must reach AUD 500,000. It opens only that offering.

### Requesting a decision

1. Open **Your company eligibility** (Eligibility requests on mobile) from Verification or
   Directory.
2. Select your evidence source. Enter the exact company identifier the company gave you or, for a
   large-investment claim, the approved offering's identifier and a whole-share quantity. Set the
   expiry you are asking for.
3. Choose **Preview company eligibility request**. The server works out the company and, for a
   product-value claim, the share class, price, currency, amount and terms, and lists any unmet
   requirement.
4. Confirm the sharing summary and the declaration separately, then submit. The request keeps that
   summary, fingerprints of the evidence and its metadata, the requested expiry and you as holder.

Once a source has been shared with a company in a request, no further supporting documents can be
attached to it. Your request list keeps each request's outcome history. You can withdraw a pending
or accepted request; a refusal stays visible.

### Deciding, withdrawing and revoking

Company approvers open **Company eligibility** from the Company page or from Company team on the
web, and from Company team on mobile. Company choices come from your own current appointments.

1. Choose your exact appointment and the company, then read the request queue and a request's
   summary.
2. Prepare an acceptance with an expiry, or a refusal with its reason, and confirm the previewed
   decision.
3. To revoke an accepted request, give a reason and confirm.

Rules:

- Reading the queue and preparing a decision need prepare or approve personally. Recording a
  decision or revocation needs approve personally. Administration, delegatable-only capabilities,
  ownership, shareholding and platform staff status do not supply this approval, so a
  prepare-only person sees the unmet approval and cannot confirm.
- Acceptance needs the participant's current identity and account standing, the evidence available
  and unchanged, and the exact scope requested. Its expiry cannot exceed the requested expiry, the
  source's limits or, for an accountant's certificate, two years from its issue.
- A refusal records its reason and grants nothing. A revocation records its reason.
- Company readers see the shared summary and the outcome history only: never private files, the
  financial basis, identity-provider results or document metadata.
- Requests, decisions, withdrawals and revocations cannot be edited or deleted and keep their
  actual person, appointment and time. A lost reply follows the
  [uncertain-outcome rule](README.md#how-a-company-decision-works).

### What a decision opens

Decisions apply at the moment of each action, against the current decision, evidence, account
standing and expiry.

- Directory: a participant sees the share classes of the companies, and the exact offerings, that
  their current decisions cover, and can open the documents of a class's approved offerings
  ([the Directory page](#the-directory-page)).
- Market: only a current general decision opens a company's market. A holder without one cannot see
  the market for shares they already own, a trade-off the owner recorded for review before live
  operation ([trading](trading.md)).
- Applications, orders and signatures: each new subscription, order, order change and swap
  signature needs the matching current decision for that company and keeps a record of it
  ([issuing shares](issuing-shares.md)).
- Payment instructions: the platform operator's bank and stablecoin payment details are shown only
  to platform staff and to people holding a current general decision from at least one company.

Account readiness concerns login, account standing and identity only; it supplies no company
permission. Company-run offering publication is not delivered.

### When eligibility ends

Eligibility ends when the company revokes it, the holder withdraws it, it expires, or the holder's
account standing, identity or wallet is lost. Then:

- the platform refuses new orders and signatures for that company at once;
- the affected company wallet approvals are queued for removal from the company's on-chain
  registry, recording the actual cause; the platform only ever removes, never adds or renews an
  approval on its own, and no removal happens while another current general decision from that
  company still covers the wallet;
- until the removal lands on chain, a direct contract call could still move shares; pausing the
  share class is the available lever
  ([approval refresh](../engineering/chain.md#refreshing-an-approval));
- none of the holder's retained subscriptions, orders or swaps is hidden.

## Wallet nominations and company wallet approvals

Possessing a wallet, being eligible and having the company approve the wallet are separate facts.
A participant proves possession; a company appointment supplies the mandate to approve a wallet
for that company's share operations. That mandate gives no permission to buy cryptocurrency through
the on-ramp, records no payment, authorises no issue and links no register member to an account
([on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)). Neither
a company appointment nor a signing preference gives anyone control of a participant's key.
Imported and walletless register members need no wallet: grants and transfers recorded in the
register create no wallet holding ([register](register.md)).

### Nominating a wallet

1. Open your eligibility request in **Your company eligibility** and go to **Nominate one own Base
   wallet**.
2. Select one of your own verified Base wallets. Refresh its possession proof if needed: the proof
   is your signed challenge, and an old verified status set without one is not enough.
3. Review and submit the nomination, confirming that the address is shared with that exact company.

A nomination needs the exact current accepted general decision for that company and its source,
account and identity conditions. One nomination selects one wallet; there is no set maximum,
withdrawal or replacement policy. The company sees only the nominated wallet's address and chain,
the eligibility source, when possession was proved, the eligibility expiry and readiness. Your
other wallets, account and identity details, balances and the proof itself stay private, and
earlier consent to share an evidence summary shares no wallets.

### Company wallet instructions

The company adds or removes a wallet on its own on-chain approval registry through a company
decision in **Company wallet approvals** on the Company eligibility page. It follows the
[prepare, approve and apply pattern](README.md#how-a-company-decision-works) and
the [owner's authority rules](../decisions.md#company-run-register-authority-and-evidence).

- Add prepares from one exact retained nomination. The instruction freezes the company, chain,
  registry, address, eligibility and proof source, a finite expiry and the transaction to be sent.
  The expiry cannot exceed the current eligibility expiry. The company must already have its
  on-chain registry; missing registry data never counts as ready.
- Remove prepares from a wallet whose addition was confirmed on chain, including an addition made
  before this workflow existed, even after the wallet record itself has been deleted. It needs no
  fresh proof or current eligibility, but the company's mandate is still checked. A historical
  approval with no confirmed addition behind it cannot be removed this way.
- Applying the approved instruction queues the chain change. Before signing, the platform rechecks
  the approving and applying mandates, the proof, the nomination and the general decision; a lost
  source holds unsigned work, and signed work is followed to its outcome
  ([whitelist changes](../engineering/chain.md#whitelist-changes)).
- Reading nominations is a limited register read and does not widen access to private eligibility
  evidence.

The earlier staff-run additions and removals and the subscription-admin approval action are
replaced by this workflow; their records remain.

### What an approval means on chain

Each company has its own approval registry, and every approval carries an expiry. A transfer
checks both sides, so a wallet whose approval has expired or been removed can neither receive nor
send that company's shares until it is approved again; there is no forced transfer, though a holder
can still burn their own shares. While a change is pending or has failed, every platform read
treats the wallet as not approved
([company-scoped approvals decision](../decisions.md#company-scoped-approvals)).

## Member profile

Profile on web and mobile shows the signed-in person's full name, residential address and phone.
Choose **Edit personal details**, change them and choose **Save personal details**. The form needs
a successfully loaded Profile and blocks a second submission while one is saving; changing the
signed-in person or session discards an old form.

These are self-reported details. Editing them does not verify your identity, and existing identity
results and signup requirements keep their rules. A Profile save creates no company appointment,
member association, register instruction or change to your register particulars. The company
changes register particulars only through its own evidenced workflow
([register](register.md)), and members ask for such a change, read their own
records and obtain their own certificates through a company-issued invitation
([member records](member-records.md)).

## Transaction monitoring

The platform monitors recorded wallet transactions for compliance review. Amounts are in
Australian dollars.

| Rule    | Name                         | Raises an alert for                                                                    | Severity |
| ------- | ---------------------------- | -------------------------------------------------------------------------------------- | -------- |
| MON-001 | Large Transaction            | A transaction of AUD 10,000 or more                                                    | Medium   |
| MON-002 | Rapid Transactions           | Five or more transactions within one hour                                              | High     |
| MON-003 | Structuring Pattern          | Three or more transactions of AUD 8,000 to 9,999 within 168 hours                      | High     |
| MON-004 | High-Risk Wallet             | A transaction involving an address that screening flags                                | High     |
| MON-005 | Sanctioned Address           | A transaction involving an address on a sanctions list                                 | Critical |
| MON-006 | New Customer SOF             | A new customer's transaction of AUD 10,000 or more without source-of-funds documents   | High     |
| MON-007 | High Aggregate Volume        | AUD 50,000 or more in total within 30 days                                             | Medium   |
| MON-008 | Dormant Account Reactivation | A transaction of AUD 5,000 or more after 90 days without activity                      | Medium   |
| MON-009 | Material Pattern Deviation   | A transaction three times the customer's 90-day average, given five prior transactions | Medium   |
| MON-010 | Round Amount Transactions    | Three or more transactions in multiples of AUD 5,000 within 30 days                    | Low      |
| MON-011 | Extreme Risk Customer        | Any transaction by a customer rated extreme risk                                       | Critical |

How transactions are valued and timed:

- Each transaction is valued when it is recorded, at the asset's US-dollar price at the block time
  converted at the exchange rate stored then. AUDY is valued at par. A transaction with no price, or
  recorded while no rate was stored, has no AUD value and no amount rule counts it.
- A transfer sent from the app is recorded before it is mined and counted once.
- The single-transaction rules look only at transactions less than an hour old, or not yet mined.
  The windows use when a transaction happened, so a newly verified wallet's imported history counts
  when it happened rather than as a burst of recent activity.
- A customer is new for 30 days after their account first became active, and an account never
  activated counts as new. The first activation date survives suspension and reactivation.

The address rules screen a transaction's address when the customer is rated high or extreme risk,
when the transaction is worth AUD 5,000 or more, or when the customer is new. A screening approves
only with a valid risk score: a score at or above the high threshold is rejected with a high alert,
one at or above the medium threshold goes to review with a medium alert, and a lower score is
approved. A result without a score stays pending for staff rather than being approved. Only a
sanctions signal makes the alert a sanctioned-address one. A completed result is final, and a
provider that cannot screen addresses (Sum&Sub today) fails every screening, which the address rule
reports as unverified ([provider configuration](../operations/configuration.md#identity-verification-providers)).

An alert changes nothing by itself: staff review it in admin, and the account, the transaction and
any company decision stay as they are.

## The Verification page

Verification (investing accounts) has three sections:

- Account readiness: **Account ready** or **Account checks needed** with the reasons, a link to Your
  company eligibility, the Directory when ready, and the reminders that readiness grants no
  investment access and that offers are made to wholesale and sophisticated investors only.
- Your claims: each source with its status (Available to share for a submitted source, Historical
  verification for one verified under the retired staff review, or its recorded status such as
  Withdrawn) and dates, and **Withdraw claim** for one still submitted.
- How you qualify: the four categories with the evidence each needs, **Submit evidence** or **Add
  evidence**, and **Request company eligibility**.

Your company eligibility (Eligibility requests on mobile) prepares a request for one company, lists
your company requests with their outcome history, offers **Prepare request withdrawal**, and holds
the wallet nomination for a selected request
([requesting a decision](#requesting-a-decision)).

Company eligibility, for company approvers and preparers, holds Your personal company authority,
the Company request queue, decision and revocation forms, and Company wallet approvals
([deciding](#deciding-withdrawing-and-revoking),
[wallet instructions](#company-wallet-instructions)).

## The Directory page

Directory (investing accounts) groups the share classes a participant may see under their company,
with its industry and location; there is no registry search. Until the account is ready it shows
**Check your investor account** with links to Verification and Your company eligibility, and with no
covered classes it explains how to request eligibility.

A share class shows its symbol, authorised and issued shares, and its current offering: **Open for
applications** with the price per share and dates, or **No offering open** until an offering has
been approved and its opening time has arrived. The documents attached to the class's approved
offerings follow. While an offering is open, a participant can prepare a draft application by
choosing a verified Base receiving wallet and a whole-share quantity; the total is worked out in
whole cents, a draft belongs to that offering only, and the server still decides the applicant,
quantity and eligibility. Creating a draft sends no payment: the operator reviews the application,
and the accepted application shows the exact amount and payment reference.

Applications shows each application's recorded company, class, currency and payment instruction
even if Directory access has since ended, keeping the exact reference, bank details or settlement
amount. A recorded partial payment shows the amount outstanding and asks the investor to confirm
any further payment with the operator. Offerings, applications, payments and allotment are
described in [issuing shares](issuing-shares.md).

## Profile and Settings

Profile shows Personal information (full name, email, phone, date of birth, address and
citizenship) with **Edit personal details**
([member profile](#member-profile)), Account status (identity
check, member since and last login) with **Review identity check**, and Supporting payslips.
Payslips are private to the person and permitted platform staff; companies cannot see them. A
payslip can be attached to a submitted claim, and an unattached one is removed under the retention
policy ([retention](../engineering/security.md#deletion-and-retention)). Uploading or
reading a payslip never establishes eligibility.

Settings holds Company settings ([company setup](companies.md)), Profile and
security (Profile and **Change password**), Appearance (**Dark theme**, remembered in this browser
or on this device; Paper is the default), Notifications (**Transaction alerts** for transaction
status changes) and Data and privacy:

- **Export data** downloads the person's account data as a JSON file
  ([account-data export](../engineering/records.md#account-data-export)).
- **Delete account** deactivates the account and removes the person's name, date of birth, phone
  number and address. Citizenship, financial profile, wallets, verification records and share
  register entries are kept. The confirmation says so, and the browser's copy of the account's data
  is cleared once the server confirms.

Mobile Settings also offers biometric sign-in, **App lock** (biometrics after the app goes into the
background), **Rate the app** and **Share with friends**, and groups password, export and deletion
under Account.

Next: [company setup](companies.md) ·
[issuing shares](issuing-shares.md) ·
[member records](member-records.md) · [trading](trading.md)
