# External capital and allotments

[Implementation index](README.md) · [Owner decision](https://github.com/Ledova/ledova/issues/868#issuecomment-6088911736)

Delivered by [PR #974](https://github.com/Ledova/ledova/pull/974) under
[#868](https://github.com/Ledova/ledova/issues/868).

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
refunds remain deferred. This first scope adds no account/member association
or member-facing access; those follow #866.

## API and verification

`/api/v1/tokens/register-allotments/` provides bounded list, create and detail
routes. Detail actions provide `file/`, `agreement-file/`, `receipt-file/`,
`decision-preview/` and `decide/`. The readonly agreement and contribution are
separate nested records; the contribution identifies its company provenance.

Migration `tokens/0004_external_allotments` belongs to the
[fresh history](../../decisions.md#minimum-tests-and-fresh-migrations); PR #974
carries the verification under the
[minimum-test policy](../../development/testing.md).
