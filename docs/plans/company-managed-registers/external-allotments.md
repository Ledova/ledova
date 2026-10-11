# External capital and allotments

[Implementation index](README.md) · [Owner decision](https://github.com/Ledova/ledova/issues/868#issuecomment-6088911736)

Delivered by [PR #974](https://github.com/Ledova/ledova/pull/974) under
[#868](https://github.com/Ledova/ledova/issues/868).

The company records an investment arranged outside Ledova and a fully paid
allotment on an opened imported register. The investor can be a new or existing
walletless member. No deployment, subscription payment or chain receipt is
required. Ledova does not collect or verify the money.

## Company journey

In the Register, open the class's External investor allotments section. The
preparation form has three groups:

1. **Person and shares:** select a retained, walletless member by name or record
   a new investor's particulars, then the whole share quantity and exact AUD
   consideration.
2. **Agreement and company receipt:** retain the agreement reference, date,
   terms and document. Separately record the company's received amount, date
   and receipt evidence.
3. **Company authority and review:** name the approving director and retain the
   company authority reference, reason and authority evidence.

The received amount allocated to this fully paid allotment must equal its
consideration. Preparing the records creates no holding or register entry.
Preview and approve the exact allotment through the existing company decision
flow; approval is separate from the company-recorded receipt. The action
**Record issue** applies that approved decision, creating one genuine ISSUE,
member position and register history effect. Its exact preview shows the
recipient's holding and issued supply before and after the action. The
agreement, contribution, decision and resulting ownership remain separate
records.

Each resulting record foregrounds the investor, quantity, consideration, stage
and relevant next action. **Record details and documents** retains the full
instruction, actors, evidence fingerprints, documents and register entry.
After issue, the company remains responsible for
[required ASIC notifications](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/company-share-issues)
and certificate execution and delivery. Ledova does not lodge a notification or
record its acceptance through this workflow; its generated
[certificates remain unsigned](register-outputs.md).

Retain the original operation and request after an uncertain response and
recover that outcome before starting another. A successful write followed by a
failed refresh must not cause another upload or submission. A changed retry is
refused; retrying the same applied decision creates no second issue.
Refreshing, a failed source read or an unavailable current appointment removes
private form fields, record contents and decision controls without discarding
an original uncertain request. Once current read access is confirmed again,
recovery sends that original request with its original appointment, preview
and decision key; it does not prepare a new issue. An upload or pending or
uncertain request holds the company selector until its outcome is resolved.
If the original preparation is absent, its unchanged request receives a
definite refusal and a second current scoped read still finds it absent, the
form releases its hold so it can be closed and reopened under current
authority. A network failure or unavailable read keeps the original request.

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
agreement, receipt and company-authority documents remain company-only.
Employee awards and non-paid grants remain distinct from paid investor capital.

## API and verification

`/api/v1/tokens/register-allotments/` provides bounded list, create and detail
routes. Detail actions provide `file/`, `agreement-file/`, `receipt-file/`,
`decision-preview/` and `decide/`. The readonly agreement and contribution are
separate nested records; the contribution identifies its company provenance.

Migration `tokens/0004_external_allotments` belongs to the
[fresh history](../../decisions.md#minimum-tests-and-fresh-migrations); PR #974
carries the verification under the
[minimum-test policy](../../development/testing.md).
The existing core allotment cases in both clients also check original preparation
and issue recovery across failed refreshes, approval without a register effect,
and private record and late-download refusal after source or authority loss.
