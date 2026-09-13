# Wallets, assets and valuations

[Architecture](README.md) · [Documentation](../README.md)

How wallet identity, ownership verification, asset identity and portfolio values are represented.

## Wallet ownership and signing

**`VERIFIED` means someone held the private key, not that a hardware device held
it.** The server issues a plain-text challenge naming the address, a timestamp
and a nonce, and on submission recovers the signer and compares it to the stored
address. Three things bound that, all in `complete_wallet_verification`: the row
is locked for the read-modify-write, the challenge is refused outside
`WALLET_VERIFICATION_CHALLENGE_MINUTES` of its issue time, and it is cleared on
success so a signature cannot be replayed. Master fingerprint, derivation path
and xpub appear nowhere in that path, so a Keystone signature and a script's are
indistinguishable to it. `signing_preference` is self-declared, client-writable,
and read by no backend authorisation decision.

**The identity check is two branches, and the gate covers one.**
`verify_wallet_signature` dispatches on chain
(`backend/wallets/services/wallets.py:36-50`): ETH, ETHEREUM and BASE take
`encode_defunct`, `recover_message` and a lowercase compare, standard EIP-191;
BTC and BITCOIN take a base64 compact signature through `bmt.verify_message`,
re-derive the address from the recovered public key by the signature's header
byte, and compare case-sensitively. That branch also refuses any address whose
prefix does not match `BITCOIN_NETWORK` — `m`, `n`, `2` or `tb1` for `test`,
`bcrt1` for `regtest`, nothing for any other value — and `parse_bitcoin_network`
in `backend/ledova_backend/chain_safety.py` refuses to start the process unless
`BITCOIN_NETWORK` is `test` or `regtest`. `test_wallet_verification.py` has no
Bitcoin case, so the gate exercises the EVM branch only.

**Two client signing paths exist, and both are legitimate.** The Keystone path
wraps the challenge as a UR/CBOR `eth-sign-request`, renders a QR, and reads an
`eth-signature` UR back through the camera; the dashboard's seed-phrase path
derives the key in the browser with `localSigner` and never stores or transmits
the phrase. The buffer hygiene is narrower than it looks: only the derived
private key copy is wiped from a `finally`, while the BIP-39 seed and master
private key are wiped on `deriveKey`'s straight-line and guarded-throw exits, so
if `masterKey.derive(derivationPath)` throws, neither is zeroed. That throw is
reachable, because `derivation_path` is a free-text `CharField` that
`wallets/serializers/wallet.py` leaves writable with no format validation.

**The dashboard path proves ownership locally before it spends anything.**
`deriveAddress` runs first and is compared case-insensitively against the
wallet's address, so a wrong phrase is refused in the browser, not by the server
after a round trip. The default path is `m/44'/60'/0'/0/0`, overridden by a
wallet's own `derivation_path`. It is offered only on EVM chains, because the
dashboard bundle has no Bitcoin software signer.

**Mobile uses the same endpoint by a different path.** It stores the phrase in
the device keychain under `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` and
`requireAuthentication: true`, and `autoVerify` reads it back under the same
options, so every read raises the OS prompt rather than only the write at setup.
It signs Bitcoin as well as EVM. It asks for no in-app confirmation, gating only
on a self-declared `signingPreference` and a set `derivationPath` and
`masterFingerprint`, and it runs no local `deriveAddress` comparison, so a
mismatched row is refused by the server rather than on the device.

**The physical hardware-wallet round trip still needs device acceptance.**
JavaScript and native probes exercise encoding, decoding and scanner boundaries;
they do not establish the combined camera/firmware journey. That check is listed in [device checks](../development/native-probes.md#pre-release-device-checks).

Reference: `backend/wallets/services/verification.py`,
`dashboard/src/pages/wallets/hooks/useWalletVerification.ts`,
`dashboard/src/utils/softwareWallet/localSigner.ts`,
`mobile/src/screens/wallets/useWalletVerification.ts`,
`mobile/src/services/secureKeyStorage.ts`. Gate:
`backend/wallets/tests/test_wallet_verification.py` and
`dashboard/src/pages/wallets/hooks/useWalletVerification.test.tsx`, whose
signature assertion recovers the signer with `ethers.verifyMessage` rather than
re-deriving it through the code that produced the signature.

## Network identity

Wallet identity is `(account, network, address)`. An account can register the
same EVM address on Ethereum and Base, each with its own UUID, verification,
holdings and transactions. EVM address case variants are the same identity
within that account and network; Bitcoin addresses retain their case.
Migration `wallets/0014` adds both database constraints and preserves existing
wallet UUIDs and financial references. It stops if old EVM records differ only
in address case within one account and network. Review those conflicting records
and their references before retrying; the migration does not merge or delete
them. Reversal also refuses if the old account/address constraint cannot
represent wallets registered on two networks.

Wallet and transaction address filters require an explicit `chain`. A
transaction query may instead supply a visible `wallet` UUID, from which the
network is derived. Queries without an address filter can still list multiple
networks. Chain filters accept the supported network names and aliases.

Share-token and whitelist operations use the application's Base registry
network; `receiving_wallet_chain` selects the payment network and does not
retarget that registry. Address-based registry identity, issuance holdings and
admin wallet selection therefore use Base wallets. Multiple accounts with the
same Base address remain ambiguous. A company needs its selected operator
wallet, or a verified owner wallet, on the requested network. Ethereum wallets
no longer stand in for Base wallets. Historical whitelist rows linked to another
network remain visible to operations for review and are excluded from registry
address resolution; their wallet ownership is not rewritten automatically.

## Asset identity and allowlisting

Asset identity is `(chain, contract_address)` through `AssetChainDeployment`.
A contract the allowlist does not know is recorded as an unverified `Asset`
under a symbol no other row owns (the declared symbol, or the symbol plus a
growing hex prefix of the contract address), compared case-insensitively.

- Unverified rows are invisible to customers: the asset list and detail,
  snapshots, favourites, wallet holdings, transactions, market values, price
  sync and the portfolio value series all filter on `is_verified`. A quarantined
  row is never priced, and its transaction is kept for audit without opening a
  `Holding`.
- Allowlist a token with the asset admin's **Mark selected assets as verified
  (allowlist a quarantined token)** action.
- Switch a contract off by deactivating its chain deployment. Transfers for it
  are then skipped and logged, never booked.
- The same address on another chain is a different contract and gets its own
  unverified row. Add a second chain's deployment to a verified row by hand in
  the admin.

## Valuation sources

Portfolio values and new asset snapshots use USD. Asset price writes record
`market` for provider/manual quotes, `nav` for NAV updates, or `par` for the
configured par reference. AUDY uses one AUD per token divided by the stored
USD/AUD exchange rate; seed-only does not create an FX quote. Sync exchange
rates before refreshing asset prices. Without a positive finite rate, a new
AUDY holding remains unpriced. A later provider outage preserves the last
valid cached quote, as it does for market prices; this is not live pricing.
Manual quotes in another currency also require a stored conversion rate.

Migration `assets/0013` preserves existing cached prices but leaves their
provenance unknown. Until a producer refresh or the admin **Update prices**
action records their source, the API returns a null current price and excludes
them from current valuations. Direct price, currency and source fields are
read-only in the admin. Historical snapshots remain unchanged; no FX history
or source is guessed for old records.

## Portfolio history

Portfolio history keeps one holding entry per asset and adds `perChain` to
each entry in the API response. Each slice identifies its network, exact
decimal quantity and wallet UUIDs, plus `marketValue` when a historical price
exists. Two registrations of the same address on different networks stay in
their respective slices; the portfolio total still sums the asset once across
those slices. The price belongs to the canonical asset and applies to each
network's recorded quantity for that date.

The breakdown comes from daily `HoldingSnapshot` rows and their wallet links.
Quantities carry forward from the last recorded day, including a recorded zero;
current live balances do not replace historical quantities. There is no history
before the first recorded holding. Dashboard and mobile expose the split under
the chart's Holdings view, following the selected date. Older responses without
network detail offer no expansion. A missing price is shown as unpriced, while
a priced zero stays zero. Base transfers use ETH for native quantities and gas
fees, and use Base's chain ID for signing.

Next: [wallet transfers](transfers.md), [history and balance reconciliation](../reference/wallet-reconciliation.md),
and [operator seeding](../operations/operator-console.md#seeding).

## Verification challenge upgrades

Wallet ownership challenges expire five minutes after issuance, including the
exact five-minute boundary. Requesting another challenge replaces the nonce and
restarts that window; successful verification consumes it. The message and the
server use the same `WALLET_VERIFICATION_CHALLENGE_MINUTES` setting and stored
issue time. Migration `wallets/0011` adds that internal timestamp. Outstanding
challenges issued before the migration have no trustworthy issue time and must
be requested and signed again. Existing verified wallets keep their status.
