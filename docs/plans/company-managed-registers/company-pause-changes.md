# Company-authorised pause and unpause

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #950](https://github.com/Ledova/ledova/pull/950).

## What the company does

A current company appointee prepares one requested pause state for a supported
deployed or paused Base class. The requested state is a strict boolean. The
company supplies a reason, an authority reference and retained AUTHORITY evidence.
The proposal freezes the company, class, actor, appointment, configured contract,
signer, exact intent and a copied evidence fingerprint and snapshot. Company
information and evidence remain provided by the company.

Pause requires no eligibility decision, nomination, payment or issue and changes
neither cap nor supply.

Authority follows the [owner's rules](../../decisions.md#company-run-register-authority-and-evidence);
register-read capability permits proposal, decision, original receipt and
private evidence reads.

## API

The six-operation `/api/v1/tokens/register-pause-changes/` family provides
preparation, list, detail, authority file, decision preview and decision. Both
clients expose these company actions independently of private owner histories.

## What is recorded

Preparation and approval create no `PauseChange`, job, signature, nonce or
token-state effect. Application consumes the exact approval and current
application appointment, retains one source-bound PENDING `PauseChange` under
the original proposal UUID, and commits its durable job atomically on the
active database alias. Rejection changes only the retained proposal. An
unresolved target refuses application before consuming the proposal. Identical
replay recovers the original result; changed terms conflict.

A genuine initial observation that the class is already in its requested state
retains its block number, block hash and observation time. Its OBSERVED result
has no outgoing operation, transaction, signature or nonce. Once execution has
selected a transaction, a later matching state cannot replace that original
transaction's result. CONFIRMED requires the original canonical successful
receipt, exact `Paused` or `Unpaused` event, configured finality and completed
projection. Missing or duplicate events and reorgs remain unresolved.

New signatures and deferred effects recheck the exact consumed company source,
current personal authority, evidence, intent and configuration. Unsigned holds,
never-signed retirement and signed work after authority loss follow the
[pause and unpause rules](../../architecture/outgoing-signing.md#pause-and-unpause),
and uncertain replies the
[company decision rule](../../architecture/outgoing-signing.md#company-decisions-and-signer-authority);
changed drafts or a later class state cannot reconstruct an original request.

The clients show the original requested state and result separately from current
class state. Approval or admitted work does not mean transfers have stopped or
resumed. A matching current state or `completedAt` alone supplies no original
transaction evidence.

## Boundaries

Fresh owner/platform-staff pause submission, confirmations and admin actions
are retired. Existing exact owner-row POST replay and GET recovery remain, bound
to their original account, actor, company, class, UUID and requested direction.
Historical actors, evidence, signed bytes, observation records and migrations
remain.
