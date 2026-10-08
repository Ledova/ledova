# Company-authorised pause and unpause

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** Fifth #867 increment implements company-authorised pause and unpause,
following empty deployments, company wallet approvals, non-paid grants and capital
increases. Exact company decisions and original observation/transaction recovery
work through the API and both clients. The pull request records final independent
review and current-main CI; no live migration or deployment is implied.
The [paid-issue workflow](company-paid-issues.md) authorises exact issues over
existing recorded payments; new payment design remains with #868/#869.

## Exact company instruction

A current company appointee prepares one requested pause state for a supported
deployed or paused Base class. The requested state is a strict boolean. The
company supplies a reason, an authority reference and retained AUTHORITY evidence.
The proposal freezes the company, class, actor, appointment, configured contract,
signer, exact intent and a copied evidence fingerprint and snapshot. Company
information and evidence remain provided by the company.

Pause adds no decimal prerequisite; the existing share-token whole-unit model
guard remains. It requires no register opening, member, wallet proof, nomination,
GENERAL classification, payment or share issue. It neither
changes the cap nor mints shares. This workflow adds no legal resolution threshold
or universal second-person rule.

Current personal `admin` can prepare, approve, apply and reject. The existing
narrower capabilities control each step; rejection uses `approve`. Ownership,
shareholding, staff privileges and technical signer configuration supply no
company mandate. Current register access permits bounded proposal, decision,
original receipt and private evidence reads.

## Preparation and decisions

The six-operation `/api/v1/tokens/register-pause-changes/` family provides
preparation, list, detail, authority file, decision preview and decision. Both
clients expose these company actions independently of private owner histories.
Preparation and human approval create no `PauseChange`, job, signature, nonce
or token-state effect. Application consumes the exact approval and current
application appointment, retains one source-bound PENDING `PauseChange` under
the original proposal UUID, and commits its durable job atomically on the
active database alias. Rejection changes only the retained proposal.

An unresolved target refuses application before consuming the proposal. Identical
replay recovers the original result; changed terms conflict. An uncertain
preparation or decision keeps its complete original body and key. Current private
read is required for receipt recovery, while changed drafts or a later class
state cannot reconstruct its original request.

## Observation, signing and original recovery

The existing pause and outgoing journals remain the execution path. Target,
company, class and source locks precede outgoing operation and signer locks.
Network reads occur outside database transactions. New signatures and deferred
effects recheck the exact consumed company source, current personal authority,
evidence, intent and configuration.

A genuine initial observation that the class is already in its requested state
retains its block number, block hash and observation time. Its OBSERVED result
has no outgoing operation, transaction, signature or nonce. Once execution has
selected a transaction, a later matching state cannot replace that original
transaction's result. CONFIRMED requires the original canonical successful
receipt, exact `Paused` or `Unpaused` event, configured finality and completed
projection. Missing or duplicate events and reorgs remain unresolved.

Temporary provider, configuration, readiness or row contention holds the same
unsigned original without new bytes or nonce. Only explicit revocation or actual
database-clock expiry of a consumed approval/application appointment permits
retirement of a genuinely never-signed original and releases its target slot.
Definite technical preparation failure keeps its meaning. Original signatures
and receipts recover after current human-source loss without inventing a renewed
company approval. Retained issuer projection keeps its existing scoped ownership
boundary; company execution does not create a fallback for that legacy write.

The clients show the original requested state and result separately from current
class state. Approval or admitted work does not mean transfers have stopped or
resumed. A matching current state or `completedAt` alone supplies no original
transaction evidence.

## Retained requests and delivery boundaries

Fresh issuer/staff pause submission, confirmations and admin actions are retired
when the company replacement works. Existing exact issuer-row POST replay and
GET recovery remain, bound to their original account, actor, company, class,
UUID and requested direction. The v1 saved-reminder key and its five fields
remain unchanged. Reload, original-direction retry, GET polling and local
completed-only dismissal retain their existing privacy, storage and native
session/epoch/transport guards. A saved UUID never admitted to the server receives
an explicit fresh-admission refusal; it is not converted into a company proposal.

Historical actors, evidence, signed bytes, observation records and migrations
remain. Current synthetic and real-chain producers use actual company evidence
and decisions; genuine predecessor records exercise retained history without a
company-approval backfill. Meaningful authority, privacy, queue, SQL/deferred,
contention, killed-worker, receipt/finality and both-client controls accompany
this slice. No live migration, deployment, signer activation, real funds or
physical-device acceptance is authorised.
