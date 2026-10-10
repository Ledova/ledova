# Non-paid register grants

[Implementation index](README.md) · [Register architecture](../../architecture/register.md) · [Company-managed plan](../../architecture/company-managed-registers.md)

Delivered by [PR #937](https://github.com/Ledova/ledova/pull/937) under
[#865](https://github.com/Ledova/ledova/issues/865).

A non-paid register grant records a company-authorised non-paid issue in an
imported register whose share class has no deployed contract. It uses the same
register and company appointments as imports, particulars and corrections. A
grant creates a genuine ISSUE entry; it does not create a subscription, payment
receipt, wallet or chain transaction. The second #865 increment provides
[non-paid register transfers](register-transfers.md) and retained
cessation/return history; grants on a deployed class are
[non-paid chain grants](company-register-issues.md). Participant account
association and own-record screens remain #866; publication workflows remain
deferred #870.

## What the company does

A current personal `admin` or `prepare` appointee prepares the grant from the
company's Register. The register must already have an applied opening import.
The company identifies an existing member by stable member ID, or supplies a new
stable member ID with their name and residential address. Names do not establish
an account link or merge members. This increment accepts only recipients with
no member-wallet links anywhere in the company; a grant to a linked wallet is
the on-chain [non-paid chain grant](company-register-issues.md) on a deployed
class.

The company supplies the whole-share quantity, terms date, non-paid terms,
reason, authority reference and named approving director. The named director
cannot be the recipient. A company appointment supplies the capability to record
the decision; it does not establish that the appointee is that director. The
director need not have a platform account. External company resolutions can be
retained without requiring every director to have an account or imposing a new
two-person rule; each decision retains its actual actor and appointment. Upload
the director-resolution authority document and terms document as
company-provided evidence. If the terms require acceptance, also retain its
acceptance document. Preparation keeps private copies, fingerprints and
snapshots. Neither those documents nor the particulars are labelled verified by
Ledova.

The preview shows the exact member, named director, terms and quantity, terms
date and actual proposed UTC entry day, current holdings, register sequence,
issued supply, authorised cap and resulting totals. A current `admin` or
`approve` appointee approves that preview; a current `admin` or `apply`
appointee then applies it with a current approval; a current `admin` or
`approve` appointee may reject it with a written reason, under the
[owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence).

## What is recorded

Application rechecks authority, evidence, identity, director conflict, register
state and authorised headroom. The bounded command keeps its constraints
deferred and checks current decision and approval authority again at commit. A
lapsed approval requires a new approval. A changed preview cannot apply an
earlier confirmation. A successful application appends one ISSUE entry dated on
the actual UTC application day and updates holdings and issued supply in one
transaction. The supplied terms date stays separate; it never backdates the
register entry, historical roll or certificate deadline. A new member and its
retained particulars are created in that same transaction. Identical retries
return the original receipt; changed retries conflict. Private documents and
grant history are available only within current company register authority.

The existing stored-register identity resolver, roll calculation and certificate
inputs consume the genuine entry and retained particulars. A walletless member
has no account recipient until #866 supplies the single account association.
Frozen rolls keep their recorded recipients and digests. This increment changes
neither publication authority nor participant access.

## Boundaries

The operator connection is trusted to execute these bounded commands. A direct
operator SQL caller can force deferred constraints to run early with
`SET CONSTRAINTS ... IMMEDIATE`; a valid effect checked before expiry can then
commit after expiry. Statement-time checks still require genuine current
appointments, approval and an exact effect. Grant HTTP routes expose no arbitrary
SQL or constraint-mode control. The commit-time expiry guarantee applies to the
normal bounded command transaction, not arbitrary operator transaction control.

Director-party comparison in the API and service preserves Python's Unicode
casefold and whitespace normalisation. PostgreSQL 16's guard uses lowercase and
whitespace normalisation, which is narrower: `Straße Example` and `STRASSE
EXAMPLE` compare equal in the service and unequal in that SQL comparison. The
customer command refuses this conflict. Arbitrary operator SQL does not receive
the service's full Unicode comparison guarantee. Transfers share both caveats.

Non-paid terms do not establish a statutory amount paid. The existing outputs
continue to show an unrecorded amount where no genuine backing amount exists;
the grant's retained terms establish its non-paid workflow. The existing
platform-staff certificate-output route is not converted into company
self-service by this increment; certificate requests and capability-scoped
output work stay with #871 and #866.

Paid allotments, AUD collection or refunds, chain issuance, tokenisation and
unsupported corporate actions are not completed by a grant. #868 records
externally arranged capital and company-approved allotments; new integrated
payment mechanics are deferred under the
[9 October priority](../../decisions.md#essential-registry-and-development-workflow-priority).
Core register work requires no crypto on-ramp purchase.

## Planned: tokenising an imported register

No open issue owns this design yet; #865 is closed and #867's remaining scope
is employee awards and vesting. Current deployment creates an empty contract;
that is not a mirror of the register. Do not treat deployment or a current
chain balance as proof that the existing holdings have been mirrored.

A future mirror must capture one exact register sequence, digest, issued supply
and member holdings under current company authority. Every mapped wallet must
have a genuine company-approved member link and the applicable possession and
eligibility checks. Walletless or ambiguous holdings must stay visibly
unresolved; do not invent addresses or new member identities. Preserve the
authorised cap and the existing share total.

Admit one immutable mirror command for that boundary, with an explicit mapping
and recovery identity. Until finalised execution and exact reconciliation, freeze
or refuse competing effects that would move the captured boundary. Recovery
must retain the original signed transactions and uncertain outcomes. A mirror
mint represents existing shares and must not append a second register ISSUE or
increase the stored supply. Verify each mapped holding and the total against
the finalised chain evidence before claiming an on-chain mirror exists. Retain
the original imports, grants, decisions and evidence throughout. This design
does not activate a signer or authorise a live migration.
