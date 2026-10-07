# Non-paid register grants

[Implementation index](README.md) · [Register architecture](../../architecture/register.md) · [Company-managed plan](../../architecture/company-managed-registers.md)

This is the first increment of [#865](https://github.com/Ledova/ledova/issues/865).
It records a company-authorised non-paid issue in an opened register whose share
class has no deployed contract. It uses the same register and company
appointments as imports, particulars and corrections. A grant creates a genuine
ISSUE entry; it does not create a subscription, payment receipt, wallet or chain
transaction. Direct ledger transfers and cessation history remain later #865
increments. Participant account association and own-record screens remain #866;
publication workflows remain #870.

## Preparation and decision

A current personal company administrator, or an appointee with register
preparation capability, prepares the grant from the company's Register. The
register must already have an applied opening import. The company identifies an
existing member by stable member ID, or supplies a new stable member ID with
their name and residential address. Names do not establish an account link or
merge members. This increment accepts recipients with no member-wallet links
anywhere in the company. Linked-wallet grants remain with later issuance work.

The company supplies the whole-share quantity, effective date, non-paid terms,
reason and authority reference. Upload the authority document and terms document
as company-provided evidence. If the terms require acceptance, also retain its
acceptance document. Preparation keeps private copies, fingerprints and
snapshots. Neither those documents nor the particulars are labelled verified by
Ledova.

The preview shows the exact member, terms and quantity, current holdings,
register sequence, issued supply, authorised cap and resulting totals. A current
administrator or register approver approves that preview. A current
administrator or register applier then applies it with a current approval. A
current administrator or approver may reject it with a written reason. There is
no compulsory second person; each decision retains its actual actor and
appointment.

Application rechecks authority, evidence, identity, register state, effective date
and authorised headroom, with current decision and approval authority checked
again at commit. A lapsed approval requires a new approval. A changed
preview cannot apply an earlier confirmation. A successful application appends
one ISSUE entry and updates holdings and issued supply in one transaction. A new
member and its retained particulars are created in that same transaction.
Identical retries return the original receipt; changed retries conflict. Private
documents and grant history are available only within current company register
authority.

## Outputs and limits

The existing stored-register identity resolver, roll calculation and certificate
inputs consume the genuine entry and retained particulars. A walletless member
has no account recipient until #866 supplies the single account association.
Frozen rolls keep their recorded recipients and digests. This increment changes
neither publication authority nor participant access.

Non-paid terms do not establish a statutory amount paid. The existing outputs
continue to show an unrecorded amount where no genuine backing amount exists;
the grant's retained terms establish its non-paid workflow. The existing staff
certificate-output route is not converted into company self-service by this
increment. Certificate requests and capability-scoped output work stay with
their owning issues.

Paid allotments, AUD collection or refunds, chain issuance, direct ledger
transfers, tokenisation and unsupported corporate actions are not completed by a
grant. #868/#869 retain the owner decisions on payment mechanics. Core register
work requires no crypto on-ramp purchase.

## Later tokenisation boundary

Tokenisation remains design-only follow-up work under #865 and the dependent
issuance programme. Current deployment creates an empty contract; that is not a
mirror of the register. Do not treat deployment or a current chain balance as
proof that the existing holdings have been mirrored.

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
