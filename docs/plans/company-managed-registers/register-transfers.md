# Non-paid register transfers

[Implementation index](README.md) · [Register architecture](../../architecture/register.md) · [Non-paid register grants](register-grants.md)

Delivered by [PR #938](https://github.com/Ledova/ledova/pull/938) under
[#865](https://github.com/Ledova/ledova/issues/865).

A company can prepare, preview, approve, apply or reject a genuine non-paid
transfer in an imported, opened register whose share class has no deployed
contract. It uses current company appointments, retained private documents and
the existing append-only ledger. Application moves shares between exact member
IDs and preserves issued supply. It creates no wallet, account association,
payment receipt, subscription, SwapOrder or chain transaction.

## What the company does

A current personal `admin` or `prepare` appointee selects the transferor,
recipient and whole-share quantity from the company's Register. The transferor
must hold enough shares in the selected class. Existing recipients retain their
stable member ID, including a former member returning with zero holdings. A new
recipient receives a new stable member ID with the company's instrument-backed
name and residential address. Where a returning member's particulars have
legitimately been purged, the company supplies new particulars for that same
ID. Names do not merge members or establish accounts. Both parties must be
walletless throughout the company for this increment.

Preparation records explicit non-paid terms, a reason, authority reference and
named approving director. The company uploads its director-resolution authority
document and the signed transfer instrument, and records the actual instrument
and lodgement dates. The named director cannot be either party; the command
checks the retained names and rechecks identity before application, under the
same [named-director rule as grants](register-grants.md#what-the-company-does).
Documents are company-provided and retain private copies, fingerprints and
snapshots.

The preview shows both exact identities, terms, quantity, documents and dates,
the register sequence, each holding before and after, and unchanged issued
supply. A current `admin` or `approve` appointee approves that exact preview; a
current `admin` or `apply` appointee applies it with a current approval; a
current `admin` or `approve` appointee may reject it with a written reason,
under the [owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence).
Changed state invalidates an earlier preview, and revoked or expired authority
refuses a new effect.

## What is recorded

Application records one genuine TRANSFER and both position changes atomically.
The entry uses the actual application day in UTC. Instrument and lodgement dates
remain separate; they never backdate the entry. Its recorder is the actual
company applier. The retained transferor member and signed instrument supply
participant provenance without inventing a transferor account. Existing chain
transfers keep their own recorder semantics. Identical retries return the
original receipt, while changed retries conflict. An uncertain client result can
be reconciled from retained transfer history before another action. Within the
open preparation form, an unchanged retry keeps its original request and
operation ID even if refreshed member data now reflects the completed effect.

A positive holding that becomes zero creates frozen member- and entry-bound
cessation history with the identity and holding at that exit. A later return
uses the same member ID and begins a new positive holding period. Compensating
corrections retain their attributable transitions and the original exit history.
Exit and return clocks use the actual UTC transition day, retaining the source
entry's effective date separately. A backdated correction cannot shorten fresh
retention or date a new return before its actual exit. Particulars edits and
invitations do not reset the exit clock. The existing 2,557-day retention floor
continues to apply; particulars remain while the member holds shares in any of
the company's classes. Retained proposal documents and identity snapshots remain
private evidence under the existing synthetic-data retention policy, separate
from the purgeable particulars projection.

Stored-register and roll calculations consume the genuine ledger and retained
identity. Certificate deadlines for these transfers use one calendar month from
the actual lodgement date. Existing chain-transfer deadlines continue to use
their retained SwapOrder input. This increment supplies certificate and roll
inputs; participant access, publication authority and company output screens
remain with #866, deferred #870 and #871. Frozen publication recipients and
digests retain their recorded meaning.

## Boundaries

This increment supports a director-resolution, signed-instrument, non-paid
transfer between identified walletless members of an imported register. It does
not implement a court-directed transfer, paid settlement, chain transfer or
tokenisation. Existing court-backed corrections remain available under their
own command. #868 records externally arranged capital and company-approved
allotments; new integrated AUD collection and settlement are deferred under the
[9 October priority](../../decisions.md#essential-registry-and-development-workflow-priority),
and non-paid terms do not invent statutory amount-paid figures or payment
evidence. Core register work requires no crypto on-ramp purchase. Unsupported
corporate actions retain their existing explicit boundaries. This imported
register boundary refuses unsupported CESSATION entries and unapproved
compensating corrections. Cessation history derives from an approved ledger
effect; corrections use the existing company preparation, approval and
application command.

The normal bounded command keeps its authority constraints deferred and rechecks
current decision and approval authority at commit; the operator-connection
`SET CONSTRAINTS` caveat and the Unicode director-comparison caveat are the
[same as for grants](register-grants.md#boundaries). The HTTP routes expose no
SQL or constraint-mode control.

Tokenising an imported register remains
[planned](register-grants.md#planned-tokenising-an-imported-register): capture
the exact ledger and member mapping, mirror existing shares once and reconcile
finalised execution before claiming delivery. Deployment alone does not
establish a mirror or authorise a second ISSUE.
