# Investors, members and eligibility

[Business processes](README.md) · [Documentation](../README.md)

How people take part in Ledova: accounts and identity checks, each company's own eligibility
decisions, wallet nominations and company wallet approvals, transaction monitoring and the
self-reported profile. It is written for investors, company approvers,
support and compliance staff, and engineers learning the domain. Members' access to their own
register records is in [member records](member-records.md).

- [Accounts and identity verification](#accounts-and-identity-verification)
- [Company eligibility decisions](#company-eligibility-decisions)
- [Wallet nominations and company wallet approvals](#wallet-nominations-and-company-wallet-approvals)
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

1. Create your account, verify your email and choose **Individual investor** as the account type.
   Company representatives follow [company signup](companies.md#company-signup).
2. At **Eligibility check**, confirm that you are 18 or older, an Australian resident and opening an
   individual account.
3. Complete your personal profile and financial profile, review them and choose **Complete
   signup**, which accepts the Terms of Service and Privacy Policy.

Mobile signup creates individual accounts only: **Welcome to Ledova** takes the place of the account
type choice. On mobile, a company account that has not finished signup sees **This app is for
shareholders** and can only sign out.

Signup does not include identity verification. Complete it afterwards from Profile on the web with
**Review identity check**; while the investor identity requirement is on, investing waits for it
([account readiness](#account-readiness)). An unfinished account can sign in again and resume.

### Going back and changing your email

Once your email is verified, **Go back** never returns to the code screen. From Choose account
type it opens **Your account**, which shows your verified email; **Continue** keeps everything you
have saved.

To use a different email, enter the new address twice there with your current password. This starts
signup again on the same account: Ledova sends a code to the new address, signs you out everywhere
and clears your account type, eligibility answers, and personal and financial details. A company you
have already saved stays with your account, because companies are never deleted, and a completed
identity check is kept too. Once you have chosen **Complete company setup**, or signup is complete,
the email can no longer be changed this way.

### Account readiness

An account is Pending Verification, Active, Rejected, Suspended or Terminated. To invest, a person
needs an investing account with an active login and a verified email, in good standing:

- With the investor identity requirement on (the default), the account must be Active and the
  person's identity verified.
- With it off, a Pending Verification account is also ready and identity is not required.
- Rejected, Suspended and Terminated accounts are never ready.

The Verification page states the reasons an account is not ready. Readiness alone opens no
company's offerings or market. Company representatives have a separate
[identity requirement](companies.md#representative-identity-requirement).

### Identity check results

The instance uses one configured identity provider, KYCAID or Sum&Sub; without one, identity
verification is unavailable
([provider configuration](../operations/configuration.md#identity-verification-providers)).
A result counts only once the provider reports the check as completed; a provisional answer, an
empty status poll or an undocumented status leaves the check pending. A KYCAID approval counts only
once the person's politically exposed person (PEP) flag is known to be yes or no
([how statuses are read](../engineering/backend.md#when-a-result-counts)).

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
  adjustment of two, by the owner's decision, respecting the compliance officer's clearance while
  keeping the PEP risk weighting. Any other uncleared PEP without a category is rejected.
- No sanctions rejection is overridden, and the FATF black-list rejection still applies.

### What applicants see

Applicants never see a screening reason. Where a decline reason reports a list match (PEP,
sanctions, compromised persons, adverse media, criminal, block list or restricted person), the
identity status and Profile show "UNABLE_TO_VERIFY" once in its place; every other reason is shown
as it is. The stored result keeps every reason, staff see them in admin, and identity notifications
name none.

## Company eligibility decisions

Eligibility is one company's decision about one participant: the participant shares an evidence
source with that company and asks for its decision, and a current company approver accepts it with
a bounded expiry or refuses it, and can later revoke it. Another company's acceptance supplies no
permission and marks no source as verified.

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
lookup reveals nothing about the company. A submitted source can be withdrawn.

### Kinds of decision

- A general decision accepts an accountant-certificate or professional-investor source for the
  deciding company. It opens that company's directory entries and its market, and it is the
  decision that a wallet nomination, a non-paid chain grant and a company wallet approval require.
- An associated-person decision is primary eligibility for the exact company the claim names. It
  opens that company's directory entries but never its market.
- A product-value decision binds the exact approved offering, whole-share quantity, AUD amount and
  terms; the amount must reach AUD 500,000. It opens only that offering.

### Requesting a decision

1. Open **Your company eligibility** from Verification or Directory.
2. Select your evidence source. Enter the exact company identifier the company gave you or, for a
   large-investment claim, the approved offering's identifier and a whole-share quantity. Set the
   expiry you are asking for. On the web, a company finds its identifier on its
   [Company page](companies.md#the-company-page), and each approved offering's on that offering's
   page, opened from [Offerings](issuing-shares.md#the-offerings-page).
3. Choose **Preview company eligibility request**. The preview shows the company and, for a
   product-value claim, the share class, price, currency, amount and terms, with any unmet
   requirement.
4. Confirm the sharing summary and the declaration separately, then submit. The request keeps that
   summary, fingerprints of the evidence and its metadata, the requested expiry and you as holder.

Once a source has been shared with a company in a request, no further supporting documents can be
attached to it. You can withdraw a pending or accepted request; a refusal stays visible.

### Deciding, withdrawing and revoking

Company approvers open **Company eligibility** at `/company/eligibility` on web.

1. Choose your exact appointment for the selected company, then read the request queue and a
   request's summary. On the web the queue shows 25 requests a page, newest first, and can be filtered by
   outcome (pending, accepted, refused, withdrawn, revoked or expired) using the Filters icon.
   Selecting an outcome applies it immediately and closes the panel.
2. Prepare an acceptance with an expiry, or a refusal with its reason, and confirm the previewed
   decision.
3. To revoke an accepted request, give a reason and confirm.

Rules:

- Reading the queue and preparing a decision need prepare or approve personally; recording a
  decision or revocation needs approve personally. Administration, delegatable-only capabilities,
  ownership, shareholding and staff status do not supply it.
- Acceptance needs the participant's current identity and account standing, the evidence available
  and unchanged, and the exact scope requested. Its expiry cannot exceed the requested expiry, the
  source's limits or, for an accountant's certificate, two years from its issue.
- A refusal or revocation records its reason; a refusal grants nothing.
- Company readers see the shared summary and the outcome history only: never private files, the
  financial basis, identity-provider results or document metadata.
- Requests, decisions, withdrawals and revocations cannot be edited or deleted; a lost reply
  follows the [uncertain-outcome rule](README.md#when-the-outcome-is-uncertain).

### What a decision opens

Decisions apply at the moment of each action, against the current decision, evidence, account
standing and expiry.

- Market: a holder without a current general decision cannot see a company's market even for
  shares they already own, a trade-off the owner recorded for review before live operation
  ([trading](trading.md)).
- Applications, orders and signatures: each new subscription, order, order change and swap
  signature needs the matching current decision for that company and keeps a record of it
  ([issuing shares](issuing-shares.md)).
- Payment instructions: the platform operator's bank and stablecoin payment details are shown only
  to platform staff and to people holding a current general decision from at least one company.

### When eligibility ends

Eligibility ends when the company revokes it, the holder withdraws it, it expires, or the holder's
account standing, identity or wallet is lost. Then:

- the platform refuses new orders and signatures for that company at once;
- the affected company wallet approvals are queued for removal from the company's on-chain
  registry, recording the actual cause; the platform only removes, never adds or renews, an
  approval on its own, and removes none while another current general decision from that company
  covers the wallet;
- until the removal lands on chain, a direct contract call could still move shares; pausing the
  share class is the available lever
  ([whitelist changes](../engineering/chain.md#whitelist-changes));
- none of the holder's retained subscriptions, orders or swaps is hidden.

## Wallet nominations and company wallet approvals

A participant proves possession of a wallet; a company appointment supplies the mandate to approve
it for that company's share operations. That mandate gives no permission to buy cryptocurrency
through the on-ramp, records no payment, authorises no issue and links no register member to an
account; neither it nor a signing preference gives anyone control of a participant's key
([on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)). A grant,
allotment or transfer on a class with no contract is a register entry only: it needs no wallet and
creates no wallet holding ([register](register.md)).

### Nominating a wallet

1. Open your eligibility request in **Your company eligibility** and go to **Nominate one own Base
   wallet**.
2. Select one of your own verified Base wallets. Refresh its possession proof if needed: the proof
   is your signed challenge, and an old verified status set without one is not enough.
3. Review and submit the nomination, confirming that the address is shared with that exact company.

A nomination needs the company's current general decision, with its source, account and identity
conditions met. One nomination selects one wallet, with no set maximum, withdrawal or replacement
policy. The company sees only the nominated wallet's address and chain, the eligibility source,
when possession was proved, the eligibility expiry and readiness; your other wallets, account and
identity details, balances and the proof stay private, and consent to share an evidence summary
shares no wallets.

### Company wallet instructions

The company adds or removes a wallet on its own on-chain approval registry through a company
decision in **Company wallet approvals** on the Company eligibility page, following the
[prepare, approve and apply pattern](README.md#how-a-company-decision-works).

- Add prepares from one exact retained nomination and fixes the wallet, its eligibility and proof,
  and a finite expiry no later than the current eligibility expiry. The company must already have
  its on-chain registry; missing registry data never counts as ready.
- Remove prepares from a wallet whose addition was confirmed on chain, including one made before
  this workflow existed or whose wallet record has since been deleted. It needs no fresh proof or
  current eligibility, but the company's mandate is still checked; a historical approval with no
  confirmed addition cannot be removed this way.
- Applying the approved instruction queues the chain change
  ([chain effects](README.md#chain-effects)). Before signing, the platform also rechecks the proof,
  the nomination and the general decision, and a lost source holds unsigned work
  ([whitelist changes](../engineering/chain.md#whitelist-changes)).
- Reading nominations is a register read: whoever can read the company's register sees them, and
  it does not widen access to private eligibility evidence.

### What an approval means on chain

Each company has its own approval registry, and every approval carries an expiry. A transfer
checks both sides, so a wallet whose approval has expired or been removed can neither receive nor
send that company's shares until it is approved again; there is no forced transfer, though a holder
can still burn their own shares. While a change is pending or has failed, every platform read
treats the wallet as not approved
([company-scoped approvals decision](../decisions.md#company-scoped-approvals)).

## Transaction monitoring

The platform raises compliance alerts for staff review from recorded wallet transactions and from
ongoing identity screening.

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
  and the exchange rate stored then (AUDY at par). One with no price, or recorded while no rate was
  stored, has no AUD value and no amount rule counts it.
- A transfer sent from the app is recorded before it is mined and counted once.
- The single-transaction rules look only at transactions less than an hour old, or not yet mined.
  The windows use when a transaction happened, so a newly verified wallet's imported history is not
  a burst of recent activity.
- A customer is new for 30 days after their account first became active, and an account never
  activated counts as new. The first activation date survives suspension and reactivation.

The address rules screen a transaction's address when the customer is rated high or extreme risk,
when the transaction is worth AUD 5,000 or more, or when the customer is new. A screening needs a
valid risk score: at or above the high threshold it is rejected with a high alert, at or above the
medium threshold it goes to review with a medium alert, below that it is approved, and without a
score it stays pending for staff. Only a sanctions signal makes the alert a sanctioned-address one.
A completed result is final, and a provider that cannot screen addresses (Sum&Sub today) fails
every screening, which the address rule reports as unverified
([provider configuration](../operations/configuration.md#identity-verification-providers)).

After an identity approval, KYCAID's ongoing database screening can report a match on a sanctions,
PEP, wanted, lost-or-stolen-document or internal list. Each new match raises one compliance alert:
critical for sanctions and wanted lists, high otherwise.

An alert changes nothing by itself: staff review it in admin, and the account, identity result,
risk assessment, transaction and any company decision stay as they are.

## The Verification page

Verification (investing accounts) has three sections:

- Account readiness: **Account ready** or **Account checks needed** with the reasons, and links to
  Your company eligibility and, when ready, the Directory.
- Your claims: each source's status and dates, with **Withdraw claim** while it is submitted. A
  submitted source shows Available to share; one verified under the retired staff review shows
  Historical verification.
- How you qualify: the four categories, **Submit evidence** or **Add evidence**, and **Request
  company eligibility**.

Your company eligibility holds your requests with their outcome history, **Prepare request
withdrawal** and the wallet nomination. Company eligibility, for company
approvers and preparers, holds Your authority, the Requests list, the decision and revocation
forms and Company wallet approvals
([deciding](#deciding-withdrawing-and-revoking)).

## The Directory page

Directory (investing accounts) groups the share classes a participant may see under their company,
with its industry and location; there is no registry search. Until the account is ready it shows
**Check your investor account** with links to Verification and Your company eligibility, and with no
covered classes it explains how to request eligibility.

A share class shows its symbol, authorised and issued shares, and its current offering: **Open for
applications** with the price per share and dates, or **No offering open** until an offering has
been approved and its opening time has arrived. The documents attached to the class's approved
offerings follow. While an offering is open, a participant can prepare a draft application for
that offering only; it sends no payment and its total is worked out in whole cents
([applying for shares](issuing-shares.md#applying-for-shares)).

Applications shows each application's recorded company, class, currency and payment instruction
(the exact reference, bank details or settlement amount) even if Directory access has since ended.
A recorded partial payment shows the amount outstanding and asks the investor to confirm any
further payment with the operator
([payments](issuing-shares.md#applications-payments-and-paid-issues)).

## Profile and Settings

### Member profile

Profile shows Personal information (full name, email, phone, date of birth, address and citizenship).
On web, one compact Account card holds password, appearance and notifications, with identity status
and **Review identity check**. Existing company and investor verification requirements stay unchanged.
Mobile keeps its Account status section, with member since and last login.
Web personal-details editing opens inline, with aligned Cancel and save actions.

To change your full name, residential address or phone, choose **Edit personal details**, change
them and choose **Save personal details**. These details are self-reported: editing them verifies
nothing and leaves existing identity results unchanged. A Profile save creates no company
appointment, member association or register instruction and does not change your register
particulars, which the
company changes only through its own evidenced workflow
([particulars](register.md#changing-a-members-particulars);
[member access](member-records.md#member-access)).

On web, Supporting payslips belongs to Verification alongside classification claims, with inline
upload and extraction details on demand. Payslips are private to the person and permitted platform
staff; companies cannot see them. A payslip can be attached to a submitted claim, and an unattached
one is removed under the retention policy ([retention clocks](../engineering/security.md#retention-clocks)). Uploading or reading a
payslip never establishes eligibility.

### Settings

On web, Dashboard selects the company used across company-related pages, without repeated company
pickers or a workspace or role selector. Company appointments and actual member links determine the
available records and actions; choosing a company grants neither.

Settings opens Profile. Team and Activation appear where company access permits, and company
documents are under **Documents** → **Company documents**. Profile shows a linked member's
Company-recorded details. Team remains reachable for accepting
a company invitation. Before company access is granted, **Settings → Profile → Manage account**
provides **Accept a company invitation**, opening the same guarded workflow. Member access stays
under company [Shareholders](register.md#the-register-page).

**Profile** combines Personal information and one Account card, with permitted Company details.
Account includes
relevant identity status, **Change password**, **Dark theme** (remembered in this browser with Paper as
the default) and **Transaction alerts** for transaction status changes. Each editor retains its own
permissions; changing personal details does not update a company's records. **Activation** retains the
[company activation workflow](companies.md#activation-and-the-registry-check).

**Manage account**, inside the Account card, keeps member-since and last-login details and these less frequent actions:

- **Export data** downloads the person's account data as a JSON file
  ([account-data export](../engineering/records.md#account-data-export)).
- **Delete account** deactivates the account and removes the person's name, date of birth, phone
  number and address. Citizenship, financial profile, wallets, verification records and share
  register entries are kept. The confirmation says so, and the browser's copy of the account's data
  is cleared once the server confirms.

For linked members, Profile also shows **Company-recorded details**: the person's name and residential address
held by the selected company, with a company-reviewed update request and its status. These are
separate from personal Profile edits ([member requests](member-records.md#particulars-requests)).

On mobile, the Account tab opens Profile and offers biometric sign-in, **App lock** (biometrics
after the app goes into the background), **Dark theme** (saved on the device), **Rate the app**,
**Share with friends** and **Sign out**. Its Account section holds **Change password**, **Export
data** (a private JSON file to save or share) and **Delete account**.

Next: [company setup](companies.md) ·
[issuing shares](issuing-shares.md) ·
[member records](member-records.md) · [trading](trading.md)
