# Outgoing history and cutover constraints

[Reference](README.md) · [Documentation](../README.md)

How to inspect legacy signing history before a future adapter cutover. Inventory does not authorize activation.

`inventory_outgoing_history` observes legacy operator history before the later
signer cutover. Run it from `backend/` with the operator management connection:

```bash
python manage.py inventory_outgoing_history
OUTGOING_CAPTURE_ID=$(python -c 'import uuid; print(uuid.uuid4())')
python manage.py inventory_outgoing_history --record --capture-id "$OUTGOING_CAPTURE_ID"
```

The first command only reads. Recording stages a private capture, every evidence
variant and append-only cutover holds together. Both modes operate locally;
neither signs, contacts a provider, broadcasts, reserves or releases a nonce,
changes the outgoing foundation, or edits a mint journal or legacy status.
Services refuse an application connection, any enclosing transaction and manual
autocommit disablement, including the originating connection before the command's
operator handoff. There is no activation or hold-resolution option.

The fixed inventory includes all share issuance journal slots, unlinked share
requests and operator transaction types in every status, plus mint, historical NAV, deployment, capital increase,
swap and whitelist source rows. Failed, reverted, completed, draft, hash-only and
hashless observations are retained. Stored transaction addresses and nonces are
claims until raw bytes establish them. Missing source links and unrecognized
payloads remain unresolved; conflicting payloads never replace one another.
Historical stablecoin burn records remain included after removal of the unused
Python burn helper. New durable NAV submissions use the common outgoing journal
and are excluded from this legacy-row inventory. A historical NAV row with no
transaction link remains unknown; that absence does not establish a local-only
update or permission to execute it.

For saved #303 mint bytes, local validation records signature/envelope validity,
the observed hash, chain, sender and nonce, exact target/value/mint calldata, and
matching request linkage separately. These checks do not establish historical
authorization. `ShareToken.chain` records a chain family such as `base`; the mint
journal has neither an independently expected historical numeric chain ID nor an
authorized signer. Today's chain configuration and key cannot supply that
history. Matching raw bytes, terms and source links therefore still carry
`missing_chain_provenance` and `missing_signer_authorization` holds. Legacy admin
hash naming continues to rely on the operator's verification; this inventory
does not replace that recovery path or validate a hash without its raw payload.

PostgreSQL collection uses one read-only repeatable-read snapshot. It closes
before local analysis and a separate durable staging transaction. A dedicated
transaction advisory lock serializes capture-ID checks, cross-capture conflict
analysis and insertion under read committed isolation. This lock coordinates
inventory writers; active signers can still advance independently. SQLite also
commits the batch atomically; a competing writer may need to retry after a busy
database refusal. The capture manifest excludes the capture clock and query
order. Re-entering the same ID with unchanged source returns the original batch;
changed selected source content, including source update timestamps, requires a
new ID. A later capture can retain new variants and append holds, but cannot
rewrite an earlier observation or clear its holds.

Reports contain counts and fixed reason codes, and always report
`cutover_authorized: false`. Private raw payloads and source snapshots have no
admin, serializer or application-role access. PostgreSQL denies even operator
UPDATE/DELETE of all three inventory tables; keep them in protected backups.
Malformed raw text is retained privately, and command errors omit database
exception text.

An inventory is a point-in-time observation to revalidate after old signers
drain. Historical pause/approval sends and offline or old CLI/binary key use are
not fully observable in these tables. Unknown historical signer identity stays
unassigned and can require a deployment-wide hold. Neither an empty mempool nor
an unchanged-looking snapshot authorizes cutover. Later adoption must drain all
old signing paths, revalidate provenance and coverage, then perform a separate
guarded import/activation. Application requests will also need scoped
authorization before a narrow operator handoff, with transaction-boundary checks
on the originating connection. Those adapter changes remain future work.
