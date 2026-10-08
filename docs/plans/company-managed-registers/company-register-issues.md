# Company-authorised non-paid on-chain grants

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** Third #867 increment implemented, following the empty-deployment
and company-wallet increments. Its pull request records the source,
independent review, executed checks and limits. Paid issuance, capital and pause
conversion remain later increments.

## Supported grant

The company prepares one outright non-paid grant on a deployed Base whole-share
class whose register was genuinely opened from the chain. It selects an exact
register member, explicit participant wallet nomination and genuine finite
company ADD outcome. Preparation retains company-provided authority, grant terms
and acceptance evidence when those terms require acceptance. It creates no paid
subscription or receipt and establishes no payment or statutory amount-paid fact.

The request uses the existing positive whole-share range, at most 2,147,483,647.
Issued supply, member holdings, authorised cap and existing reservations remain
separate quantities. The terms date records the company's terms; a later ISSUE
entry uses the actual register-recording date.

A current personal `admin` appointment can prepare, approve, apply and reject.
Existing narrower step capabilities remain; rejection uses `approve`. A named
approving director and the existing recipient conflict check remain distinct
from the acting appointee. External company resolutions can be retained without
requiring every director to have an account or imposing a new two-person rule.
Ownership, staff access and technical signer configuration grant no company mandate.

Imported non-tokenised registers keep their separate walletless grant workflow.
An import-origin book cannot use this chain grant, including an imported zero
book after deployment. Deployment does not supply a new chain opening or mirror
populated holdings. Missing or uninitialised register data does not establish zero.

## Member and wallet selection

The company uses only the participant's selected nomination. Possession proof,
current exact-company GENERAL eligibility, finite company wallet approval and
the documentary member-wallet link are independently required. The preparation
identifies the original ADD change explicitly; matching an address alone does
not identify that approval.

Before a first grant, the company can use the existing LINK instruction to link
this selected nominated address to a new zero-position member, or explicitly
select an existing member. LINK retains its own authority evidence, approval
and application. No previous mint or waiting share effect is required. The grant
validates the exact same-company member link and captures the existing identity
resolver's actual source; names, addresses and accounts are not matched to infer
an association. This introduces no shareholder claim or invitation policy from #866.

## Decisions, execution and register entry

The bounded API family is `/api/v1/tokens/register-issues/`: create, list, detail,
`decision-preview`, `decide` and retained authority, terms and acceptance files.
Its review identifies the exact company, class, member, nomination, original
wallet approval, quantity, documentary fingerprints, opening and transaction
intent. Private account, profile, user and proof identifiers remain internal.

Preparation freezes one genuine `ShareIssuanceRequest` in its existing
`UNDER_REVIEW` state, without reserving shares. Human approval leaves execution
unadmitted. Application consumes that exact approval, makes the request approved
and admits its original execution job, reserving the allocation once. It creates
no immediate holding or register entry. Existing outgoing journals retain the original dispatch,
claim, signed bytes, nonce, transaction, receipt and finality outcome.

Fresh signing rechecks the original company mandates, source, evidence and exact
terms. Temporary contention retains unsigned work without a signed attempt or
new nonce. Already signed work recovers its original receipt after authority or
source loss. A finalised genuine Mint and its original member instruction are
required for the matching holding and once-only register ISSUE. Completion of a
chain journal and completion of register recording remain distinguishable; an
unentered original allocation cannot silently free its reserved headroom.

## Privacy and uncertain requests

Current exact-company register access controls proposals and retained files;
metadata access does not expose legacy private issuer histories or participant
wallet and eligibility directories. Both clients retain the exact original body,
operation key, evidence uploads and expected receipt within the current session.
Current read access can recover an original receipt after fresh step authority
or source readiness is lost. Changed retries conflict and do not replace the
original recipient, nomination, approval, terms or execution identity.

Account, company, class and session changes guard transport and final document
callbacks. Mobile additionally binds its current session epoch. An unavailable
read remains unavailable; component state does not promise replay after process loss.

## Verification boundary

This increment owns ordinary and genuine scoped authority/privacy controls,
direct SQL refusal, exact and changed retries, queue rollback, current-source
expiry, headroom and lock contention, original signed recovery, once-only Mint
inclusion and retained migration history. Both clients verify the selected-wallet
LINK bootstrap, exact grant decisions, uncertain original receipts and current
session guards. Actual commands, failures and later repairs belong in the PR.
Required current-main CI, schema/types/source/native checks, isolated real-chain
evidence and wholly nonauthor review precede merge. This is a partial #867 grant
increment; the complete company/member journey remains #873.
