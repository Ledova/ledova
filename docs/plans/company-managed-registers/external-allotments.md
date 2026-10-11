# External capital and allotments

[Implementation index](README.md) · [Owner decision](https://github.com/Ledova/ledova/issues/868#issuecomment-6088911736)

The company records an investment arranged outside Ledova and a fully paid
allotment on an opened imported register. The investor can be a new or existing
walletless member. No deployment, subscription payment or chain receipt is
required. Ledova does not collect or verify the money.

## Company journey

In the Register, open the class's External allotments section. Record the
investor's retained particulars, whole share quantity and exact AUD
consideration. Retain the external agreement's reference, date, terms and
supporting document. Separately record the company's received amount, date and
receipt evidence, then the named approving director, company authority
reference and authority evidence.

The received amount allocated to this fully paid allotment must equal its
consideration. Preparing the records creates no holding or register entry.
Preview and approve the exact allotment through the existing company decision
flow; approval is separate from the company-recorded receipt. Applying the
approved decision creates one genuine ISSUE, member position and register
history effect. The agreement, contribution, decision and resulting ownership
remain separate records.

Retain the original operation and request after an uncertain response and
recover that outcome before starting another. A successful write followed by a
failed refresh must not cause another upload or submission. A changed retry is
refused; retrying the same applied decision creates no second issue.

## Authority and records

Preparation, approval and application require their current company
capabilities, with the existing director-conflict rule. Company owners and
platform staff have no automatic private financial access. Lists, details and
all three documents require a current personal appointment for the exact
company. Cached private rows disappear when that authority cannot be confirmed.

The retained records bind the company, class, investor identity, quantity,
consideration, evidence, actor and appointments. PostgreSQL guards preserve
append-only history, approval, supply/headroom and one applied effect. A receipt
attestation is visibly company-recorded; it grants no issue authority and is
not Ledova verification. Amount-paid outputs retain genuine supported
provenance rather than inventing a value after incompatible history.

The existing [trusted operator transaction and director-name comparison
boundaries](register-grants.md#boundaries) apply. Normal bounded commands retain
their commit checks; arbitrary operator transaction control is outside that
guarantee.

Partly paid allotments, calls, outstanding amounts, collection, providers and
refunds remain deferred. The separate [member invitation and own-record flow](member-access.md)
lets accepted recipients read their own resulting holdings and history. Private
agreement, receipt and company-authority documents remain company-only. Employee awards and non-paid grants
remain distinct from paid investor capital.

## API and verification

`/api/v1/tokens/register-allotments/` provides bounded list, create and detail
routes. Detail actions provide `file/`, `agreement-file/`, `receipt-file/`,
`decision-preview/` and `decide/`. The readonly agreement and contribution are
separate nested records; the contribution identifies its company provenance.

Fresh migrations install the records and their PostgreSQL guards before the
shared role/policy catalogue. The minimum core API journey and essential
authority/isolation/retry refusals, small client core flows, PostgreSQL
role/catalogue checks and canonical schema cover this increment. The
[minimum-test policy](../../development/testing.md) applies; broad retired
fixtures and shipped-migration rewinds are not restored.
