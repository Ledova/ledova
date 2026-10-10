# Company-authorised non-paid chain grants

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #944](https://github.com/Ledova/ledova/pull/944).

A non-paid chain grant mints outright shares on a deployed class. Off-chain
grants in an imported register use the separate
[non-paid register grant](register-grants.md) workflow.

## What the company does

The company prepares one outright non-paid chain grant on a deployed Base
whole-share class whose register was genuinely opened from the chain. It selects
an exact register member, explicit participant wallet nomination and genuine
finite company ADD outcome. Preparation retains company-provided authority,
grant terms and acceptance evidence when those terms require acceptance. It
creates no paid subscription or receipt and establishes no payment or statutory
amount-paid fact.

The request uses the existing positive whole-share range, at most 2,147,483,647.
Issued supply, member holdings, authorised cap and existing reservations remain
separate quantities. The terms date records the company's terms; a later ISSUE
entry uses the actual register-recording date.

A current `admin` appointment may prepare, approve, apply and reject, with
`prepare`, `approve` and `apply` as the narrower delegate capabilities, under
the [owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence);
ownership, platform staff access and technical signer configuration grant no
company mandate. The named approving director and the existing recipient
conflict check follow the [register grant rule](register-grants.md#what-the-company-does).

An import-origin book cannot use this chain grant, including an imported zero
book after deployment. Deployment does not supply a new chain opening or mirror
populated holdings. Missing or uninitialised register data does not establish
zero.

The company uses only the participant's selected nomination. Possession proof,
a current exact-company
[general eligibility decision](company-eligibility.md#general-associated-person-and-product-value-decisions),
finite company wallet approval and the documentary member-wallet link are
independently required. The preparation identifies the original ADD change
explicitly; matching an address alone does not identify that approval.

Before a first grant, the company can use the existing LINK instruction to link
this selected nominated address to a new zero-position member, or explicitly
select an existing member. LINK retains its own authority evidence, approval
and application. No previous mint or waiting share effect is required. The grant
validates the exact same-company member link and captures the existing identity
resolver's actual source; names, addresses and accounts are not matched to infer
an association. This introduces no shareholder claim or invitation policy from
#866.

## API

The family is `/api/v1/tokens/register-issues/`: create, list, detail,
`decision-preview`, `decide` and retained authority, terms and acceptance files.
Its review identifies the exact company, class, member, nomination, original
wallet approval, quantity, documentary fingerprints, opening and transaction
intent. Private account, profile, user and proof identifiers remain internal.

## What is recorded

Preparation freezes one genuine `ShareIssuanceRequest` in its existing
`UNDER_REVIEW` state, without reserving shares. Approval leaves execution
unadmitted. Application consumes that exact approval, makes the request approved
and admits its original execution job, reserving the allocation once. It creates
no immediate holding or register entry. Existing outgoing journals retain the
original dispatch, claim, signed bytes, nonce, transaction, receipt and finality
outcome.

Fresh signing rechecks the original company mandates, source, evidence and exact
terms. Unsigned holds and signed work after authority or source loss follow the
[share issuance rules](../../architecture/outgoing-signing.md#share-issuances),
and uncertain replies the
[company decision rule](../../architecture/outgoing-signing.md#company-decisions-and-signer-authority).
A finalised genuine Mint and its original member instruction are required for
the matching holding and once-only register ISSUE. Completion of a chain journal
and completion of register recording remain distinguishable; an unentered
original allocation cannot silently free its reserved headroom.

Current exact-company register-read capability controls proposals and retained
files; metadata access does not expose private legacy owner histories or
participant wallet and eligibility directories. Both clients retain the exact
original body, operation key, evidence uploads and expected receipt within the
current session; account, company, class and session changes guard transport
and final document callbacks, and mobile additionally binds its session epoch.
Changed retries conflict and do not replace the original recipient, nomination,
approval, terms or execution identity.
