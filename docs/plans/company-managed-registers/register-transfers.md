# Non-paid register transfers

[Implementation index](README.md) · [Register architecture](../../architecture/register.md) · [Non-paid grants](register-grants.md)

This increment of [#865](https://github.com/Ledova/ledova/issues/865) lets a
company prepare, preview, approve, apply or reject a genuine non-paid transfer
in an imported, opened register whose share class has no deployed contract.
It uses current company appointments, retained private documents and the
existing append-only ledger. Application moves shares between exact member IDs
and preserves issued supply. It creates no wallet, account association, payment
receipt, subscription, SwapOrder or chain transaction.

## Preparation and authority

A current personal company administrator or register preparer selects the
transferor, recipient and whole-share quantity from the company's Register.
The transferor must hold enough shares in the selected class. Existing
recipients retain their stable member ID, including a former member returning
with zero holdings. A new recipient receives a new stable member ID with the
company's instrument-backed name and residential address. Where a returning
member's particulars have legitimately been purged, the company supplies new
particulars for that same ID. Names do not merge members or establish accounts.
Both parties must be walletless throughout the company for this increment.

Preparation records explicit non-paid terms, a reason, authority reference and
named approving director. The company uploads its director-resolution authority
document and the signed transfer instrument, and records the actual instrument
and lodgement dates. The named director cannot be either party; the command
checks the retained names and rechecks identity before application. A company
appointment supplies the capability to record the decision; it does not establish
that the appointee is the named director. Documents are company-provided and
retain private copies, fingerprints and snapshots.

The preview shows both exact identities, terms, quantity, documents and dates,
the register sequence, each holding before and after, and unchanged issued
supply. A current administrator or register approver approves that exact preview.
A current administrator or register applier applies it with a current approval.
A current administrator or approver may reject it with a written reason. No
compulsory second person is introduced. Changed state invalidates an earlier
preview, and revoked or expired authority refuses a new effect.

## Entry, history and outputs

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
retention or date a new return before its actual exit.
Particulars edits and invitations do not reset the exit clock. The existing
2,557-day retention floor continues to apply; particulars remain while the member
holds shares in any of the company's classes. Retained proposal documents and
identity snapshots remain private evidence under the existing synthetic-data
retention policy, separate from the purgeable particulars projection.

Stored-register and roll calculations consume the genuine ledger and retained
identity. Certificate deadlines for these transfers use one calendar month from
the actual lodgement date. Existing chain-transfer deadlines continue to use
their retained SwapOrder input. This increment supplies certificate and roll
inputs; participant access, publication authority and company output screens
remain with #866, #870 and #871. Frozen publication recipients and digests retain
their recorded meaning.

## Supported boundary

This slice supports a director-resolution, signed-instrument, non-paid transfer
between identified walletless members of an imported non-tokenised register.
It does not implement a court-directed transfer, paid settlement, chain transfer
or tokenisation. Existing court-backed corrections remain available under their
own command. #868/#869 retain the owner's AUD collection and settlement choices;
non-paid terms do not invent statutory amount-paid figures or payment evidence.
Core register work requires no crypto on-ramp purchase. Unsupported corporate
actions retain their existing explicit boundaries. This imported non-tokenised
boundary refuses unsupported CESSATION entries and unapproved compensating
corrections. Cessation history derives from an approved ledger effect; corrections
use the existing company preparation, approval and application command.

The normal bounded command keeps its authority constraints deferred and rechecks
current decision and approval authority at commit. The operator connection is
trusted to execute that command. As with grants, an arbitrary operator SQL caller
can force deferred constraints early with `SET CONSTRAINTS ... IMMEDIATE`;
statement-time checks still require genuine current mandates and an exact
effect, but the normal commit-time expiry guarantee does not extend to arbitrary
operator transaction control. The HTTP routes expose no SQL or constraint-mode
control.

Director-party comparison in the API and service preserves Python's Unicode
casefold and whitespace normalization. PostgreSQL 16's guard uses lowercase and
whitespace normalization, which is narrower: `Straße Example` and `STRASSE
EXAMPLE` compare equal in the service and unequal in that SQL comparison. The
customer command refuses this conflict. An arbitrary operator SQL caller does
not receive the service's full Unicode comparison guarantee.

Later tokenisation remains the [design-only boundary](register-grants.md#later-tokenisation-boundary):
capture the exact ledger and member mapping, mirror existing shares once and
reconcile finalised execution before claiming delivery. Deployment alone does
not establish a mirror or authorise a second ISSUE.
