# Investors and members

[Business processes](README.md) · [Documentation](../README.md)

How people take part in Ledova: accounts, wallet nominations and company wallet
approvals, transaction monitoring and the self-reported profile. It is written for investors,
company approvers, support and compliance staff, and engineers learning the domain. Members' access
to their own register records is in [member records](member-records.md).

- [Accounts](#accounts)
- [Wallet nominations and company wallet approvals](#wallet-nominations-and-company-wallet-approvals)
- [Transaction monitoring](#transaction-monitoring)
- [Profile and Settings](#profile-and-settings)

Two facts stay separate throughout: whether an account is in good standing, and whether a
particular company has approved a wallet to hold its shares. Neither implies the other. Ledova
does not verify anyone's identity ([decision](../decisions.md#identity-verification-removed)), and there
are no investor classification claims, payslips or company eligibility decisions
([decision](../decisions.md#verification-limited-to-id-checks)).

New wallet nominations, company wallet instructions and chain whitelist changes are unavailable
under the [registry-only execution boundary](../engineering/chain.md#registry-only-execution-boundary).
Their scoped records remain readable. The wallet sections below describe retained records and
original controls, not a supported new-action workflow.

## Accounts

### Investor signup

1. Create your account, verify your email and choose **Individual investor** as the account type.
   Company representatives follow [company signup](companies.md#company-signup).
2. Complete your personal profile, review it and choose **Complete signup**, which accepts the
   Terms of Service and Privacy Policy. Signup asks no eligibility questions and collects no
   financial-profile answers, on the web or in the app.

An unfinished account can sign in again and resume.

### Going back and changing your email

Once your email is verified, **Go back** never returns to the code screen. From Choose account
type it opens **Your account**, which shows your verified email; **Continue** keeps everything you
have saved.

To use a different email, enter the new address twice there with your current password. This starts
signup again on the same account: Ledova sends a code to the new address, signs you out everywhere
and clears your account type and your personal and financial details. A company you
have already saved stays with your account. Once you have chosen **Complete company setup**, or signup is complete,
the email can no longer be changed this way.

### Recovering your password

On the web, choose **Forgot password?** on Sign in and enter your email. The acknowledgement is
the same whether or not an eligible account exists. An active account with verified email receives
a reset link, valid for ten minutes and one use. Open it, enter and confirm a new password, then
sign in again. A successful reset signs out every existing session; it does not reactivate an
account or change company access.

Delivery requires the installation's email sender and worker. The current hosted preview's
delivery limitations remain separate from this software flow; provider acceptance alone does not
establish inbox delivery. This web increment adds no mobile reset screen.

### Account standing

An account is Pending, Active, Rejected, Suspended or Terminated. A wallet nomination, a company
wallet approval and trading through the API need a current participant: an investing account with an
active login and a verified email, in good standing. A Pending or Active account qualifies; Rejected, Suspended and Terminated accounts never do. A nomination's preview
names any requirement not met.

## Wallet nominations and company wallet approvals

A participant proves possession of a wallet; a company appointment supplies the mandate to approve
it for that company's share operations. That mandate gives no permission to buy cryptocurrency
through the on-ramp, records no payment, authorises no issue and links no register member to an
account; neither it nor a signing preference gives anyone control of a participant's key
([on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)). A grant,
allotment or transfer on a class with no contract is a register entry only: it needs no wallet and
creates no wallet holding ([register](register.md)).

The web app no longer offers nominations or approvals: the owner removed them with the wallet pages
on 31 October 2026 ([decision](../decisions.md#wallets-removed-from-the-web-app),
[#1452](https://github.com/Ledova/ledova/issues/1452)). The API keeps them, with the rules below.

### Nominating a wallet

A nomination selects one of the participant's own verified Base wallets, with a current possession
proof: their signed challenge, since an old verified status set without one is not enough. It names
the company directly, and submitting it confirms that the address is shared with that exact company.

A nomination needs a current participant ([account standing](#account-standing)) and an active
company; no eligibility decision is involved. One nomination selects one wallet, with no set
maximum, withdrawal or replacement policy. The company sees only the nominated wallet's address and
chain, when possession was proved and readiness, which says whether you are still current but
never why; your other wallets, account and identity details, balances and the proof stay private.

### Company wallet instructions

The company adds or removes a wallet on its own on-chain approval registry through a company
decision, following the [prepare, approve and apply pattern](README.md#how-a-company-decision-works).

- Add prepares from one exact retained nomination and fixes the wallet and its proof, and a finite
  expiry in whole seconds that the company chooses. The company must already have its on-chain
  registry; missing registry data never counts as ready.
- Remove prepares from a wallet whose addition was confirmed on chain, including one made before
  this workflow existed or whose wallet record has since been deleted. It needs no fresh proof and
  no current participant, but the company's mandate is still checked; a historical approval with no
  confirmed addition cannot be removed this way.
- Applying the approved instruction queues the chain change
  ([chain effects](README.md#chain-effects)). Before signing, the platform also rechecks the proof,
  the nomination and the participant's standing, and a lost source holds unsigned work
  ([whitelist changes](../engineering/chain.md#whitelist-changes)).
- Reading nominations is a register read: whoever can read the company's register sees them.

Nominations and instructions recorded before investor eligibility was removed on 2 November 2026
keep their history, but their snapshots name eligibility records, so they no longer pass the
readiness checks: the participant nominates the wallet again, and a pending instruction is prepared
again.

### What an approval means on chain

Each company has its own approval registry, and every approval carries an expiry. A transfer
checks both sides, so a wallet whose approval has expired or been removed can neither receive nor
send that company's shares until it is approved again; there is no forced transfer, though a holder
can still burn their own shares. While a change is pending or has failed, every platform read
treats the wallet as not approved
([company-scoped approvals decision](../decisions.md#company-scoped-approvals)).

Through the trading API, a company's market, its new orders, order changes and swap signatures need
a current participant whose wallet holds a live approval from that company ([trading](trading.md)).

### When an approval is removed automatically

An approval ends at its expiry, or when the company removes it. The platform also queues it for
removal from the company's on-chain registry when the holder's account standing or wallet is lost.
Then:

- the platform refuses new orders and signatures for that company at once;
- the removal records the actual cause; the platform only removes, never adds or renews, an
  approval on its own. A lost standing removes nothing once the participant is current again, but a
  wallet that was removed or lost its verification loses its approval even then;
- until the removal lands on chain, a direct contract call could still move shares; pausing the
  share class is the available lever
  ([whitelist changes](../engineering/chain.md#whitelist-changes));
- none of the holder's retained orders or swaps is hidden.

## Transaction monitoring

The platform raises compliance alerts for staff review from recorded wallet transactions.

| Rule    | Name                         | Raises an alert for                                                                    | Severity |
| ------- | ---------------------------- | -------------------------------------------------------------------------------------- | -------- |
| MON-001 | Large Transaction            | A transaction of AUD 10,000 or more                                                    | Medium   |
| MON-002 | Rapid Transactions           | Five or more transactions within one hour                                              | High     |
| MON-003 | Structuring Pattern          | Three or more transactions of AUD 8,000 to 9,999 within 168 hours                      | High     |
| MON-006 | New Customer SOF             | A new customer's transaction of AUD 10,000 or more without source-of-funds documents   | High     |
| MON-007 | High Aggregate Volume        | AUD 50,000 or more in total within 30 days                                             | Medium   |
| MON-008 | Dormant Account Reactivation | A transaction of AUD 5,000 or more after 90 days without activity                      | Medium   |
| MON-009 | Material Pattern Deviation   | A transaction three times the customer's 90-day average, given five prior transactions | Medium   |
| MON-010 | Round Amount Transactions    | Three or more transactions in multiples of AUD 5,000 within 30 days                    | Low      |

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

An alert changes nothing by itself: staff review it in admin, and the account, transaction and any
company decision stay as they are.

## Profile and Settings

### Member profile

Signup, on the web and in the app, collects a full name after email verification. It does not
request a birth date, phone or address.

Profile shows Personal information: full name, email, address and citizenship, with a phone number
or date of birth only where the account already holds one. Personal-details editing opens inline,
with aligned Cancel and save actions.

To change your full name or address, choose **Edit**, change
them and choose **Save**. These details are self-reported. A Profile save creates no company
appointment, member association or register instruction. While your account is linked to a member of
a company's register, saving your full name or residential address also updates that register, with
a dated record in its history; an empty field keeps what the register holds. An address can be
postal; Ledova does not require every company administrator to provide a residential address
([particulars from Profile](member-records.md#particulars-from-profile);
[member access](member-records.md#member-access)).

### Settings

On web, Dashboard selects the company used across company-related pages, without repeated company
pickers or a workspace or role selector. Company appointments and actual member links determine the
available records and actions; choosing a company grants neither.

Settings opens Profile, with **Account** and **Data and privacy** beside it for everyone. Team
appears where company access permits. It remains reachable for accepting
a company invitation: **Settings → Account → Invitations → Company officer invitation** provides
**Accept**, opening Team's guarded accept form. Member access stays
under company [Shareholders](register.md#the-register-page), on the web and in the app.

**Profile** combines Personal information with permitted Company details. Each editor retains its own
permissions; personal changes do not edit company information, but linked member particulars follow
the Profile change described above.

**Account** shows **Security** (the password with **Change**), **Account details** (**Member since**, such as "21 Oct 2026", and **Last
login**, such as "2 Nov 2026, 1:38 pm"), **Terms of Service**, **Invitations** and **Your appointments**.
Terms shows the accepted version’s timestamp or an explicit **Accept** action beside the
versioned text; earlier booleans are not treated as acceptance. Invitations has a
**Shareholder invitation** row whose **Accept** opens Member invitation, and a **Company officer
invitation** row whose **Accept** opens Team's accept form (owner, 3 and 5 November 2026). Your
appointments lists your company appointments, with **Show the declaration** where one was recorded
and **Revoke** until it is revoked, and, for a company's owner, **Representative authority**
([appointments](companies.md#team-invitations-and-appointments)). The theme is the **Dark theme** switch beside Sign
out (remembered in this browser with Paper as the default); the web app no longer offers transaction
alerts ([#1452](https://github.com/Ledova/ledova/issues/1452)).

**Data and privacy** holds the less frequent actions, in the same rows as Account: each names the
action and what it does on the left, with **Export** or **Delete** on the right.

- **Export data** downloads an account summary as JSON, separate from company-held records
  ([account-data export](../engineering/records.md#account-data-export)).
- **Delete account** ends sign-in and erases personal profile and financial answers, preferences,
  device tokens and inbox notifications. Company
  particulars, documents, history and genuine retained transaction/case evidence remain separate.
  The confirmation explains this scope; the browser clears account data after success. See
  [account erasure](../engineering/security.md#account-closure-and-export) for exact clocks.
  Deleting a company is separate ([Deleting a company](companies.md#deleting-a-company)).

On mobile, Settings has the same three pages for the selected company, then
[Team](companies.md#team-invitations-and-appointments) where that company can be managed. Its current Account has **Security**, **Account details**,
**Invitations** and **Your appointments**; the new web Terms renewal card is not yet a native screen.
Security has **Change** for the password and the biometric sign-in (such as
**Face ID sign-in**) and **App lock** switches, App lock asking for biometrics when you come back to
the app. Invitations' **Shareholder invitation** row opens the app's member
[invitation](member-records.md#accepting-an-invitation), and its **Company officer invitation** row
opens Team's accept form, as on the web. On
Data and privacy, **Export** saves or shares a private JSON file. **Sign out** and the **Dark
theme** switch, saved on the device, are in the menu.

Next: [company setup](companies.md) ·
[issuing shares](issuing-shares.md) ·
[member records](member-records.md) · [trading](trading.md)
