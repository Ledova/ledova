# Wallets, assets and valuations

[Architecture](README.md) · [Documentation](../README.md)

How wallet identity, ownership verification, asset identity and portfolio values are represented.

## Wallets and company decisions

Wallet-possession proof stays with the participant; a company's registry
approval of that wallet is a separate
[company decision](../plans/company-managed-registers/company-wallet-approvals.md).
Neither a company appointment nor a self-declared signing preference grants
control of a participant's key. Imported and non-tokenised register members can
have no wallet: [non-paid grants](../plans/company-managed-registers/register-grants.md)
and transfers are ledger events that create no wallet holding or mint receipt,
and later tokenisation mirrors them without issuing twice. Infrastructure asset
allowlisting, settlement-token minting and yield-token NAV controls are separate
capabilities, not an automatic grant to a company register administrator.

## Wallet ownership and signing

**`VERIFIED` means someone held the private key, not that a hardware device held
it.** The server issues a plain-text challenge naming the address, a timestamp
and a nonce, and on submission recovers the signer and compares it to the stored
address. Three things bound that, all in `complete_wallet_verification`: the row
is locked for the read-modify-write, the challenge is refused outside
`WALLET_VERIFICATION_CHALLENGE_MINUTES` (five minutes, including the exact
boundary) of its stored issue time, and it is cleared on success so a signature
cannot be replayed; requesting another challenge replaces the nonce and restarts
the window. Master fingerprint, derivation path and xpub appear nowhere in that
path, so a Keystone signature and a script's are indistinguishable to it.
`signing_preference` is self-declared, client-writable, and read by no backend
authorisation decision.

**The identity check is two branches.** `verify_wallet_signature` dispatches on
chain (`backend/wallets/services/wallets.py`): ETH, ETHEREUM and BASE take
`encode_defunct`, `recover_message` and a lowercase compare, standard EIP-191;
BTC and BITCOIN take a base64 compact signature through `bmt.verify_message`,
re-derive the address from the recovered public key by the signature's header
byte, and compare case-sensitively. That branch also refuses any address whose
prefix does not match `BITCOIN_NETWORK` (`m`, `n`, `2` or `tb1` for `test`,
`bcrt1` for `regtest`, nothing for any other value), and `parse_bitcoin_network`
in `backend/ledova_backend/chain_safety.py` refuses to start the process unless
`BITCOIN_NETWORK` is `test` or `regtest`.

**Two client signing paths exist, and both are legitimate.** The Keystone path
wraps the challenge as a UR/CBOR `eth-sign-request`, renders a QR, and reads an
`eth-signature` UR back through the camera; the dashboard's seed-phrase path
derives the key in the browser with `localSigner` and never stores or transmits
the phrase. Both clients' `localSigner` modules are built on the shared
`createLocalSigner`, which holds the key handling and the EVM signing, and each
passes it its own `ethers` and `ethereum-cryptography`, the copies it bundles;
mobile adds Bitcoin message signing on the same key handling. The derived
private key is wiped in a `finally`, while the BIP-39 seed and master key are
wiped only on `deriveKey`'s normal and guarded exits, so a throw from
`masterKey.derive(derivationPath)` leaves them unzeroed; that throw is reachable
because `derivation_path` is a free-text `CharField` with no format validation.

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
`packages/shared/src/utils/local-signer.ts`,
`dashboard/src/utils/softwareWallet/localSigner.ts`,
`mobile/src/utils/softwareWallet/localSigner.ts`,
`mobile/src/screens/wallets/useWalletVerification.ts`,
`mobile/src/services/secureKeyStorage.ts`.

## Network identity

Wallet identity is `(account, network, address)`. An account can register the
same EVM address on Ethereum and Base, each with its own UUID, verification,
holdings and transactions. EVM address case variants are the same identity
within that account and network; Bitcoin addresses retain their case.

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

- Unverified rows are invisible to customers: the asset list, wallet holdings,
  transactions, market values and price sync all filter on `is_verified`. A
  quarantined row is never priced, and its transaction is kept for audit without
  opening a `Holding`.
- Allowlist a token with the asset admin's **Mark selected assets as verified
  (allowlist a quarantined token)** action.
- Switch a contract off by deactivating its chain deployment. Transfers for it
  are then skipped and logged, never booked.
- The same address on another chain is a different contract and gets its own
  unverified row. Add a second chain's deployment to a verified row by hand in
  the admin.

## A share holding names its class

A share class becomes an asset when it is deployed (`bridge_share_asset`),
named after the company and the class, with the class's Base contract as its
deployment. That contract is the only link between the two. So
`GET /api/wallets/{uuid}/holdings/` resolves each row's `shareClass`
(`uuid`, `name`, `symbol` and `companyName`) as it reads: from the asset's Base
contract to the class deployed there, inside the holdings query and under the
caller's policies (`with_share_class` in `wallets/querysets/share_class.py`). The
class lookups use one SQL statement; the route's existing deployment and yield
reads remain separate. An absent Base deployment, unmatched contract or class
hidden by those policies leaves `shareClass` null and preserves the holding. An
investor reads another company's class only while it is on the market, so a
paused class keeps its row with `shareClass` null and the asset's combined name
stands in. A company owner can still read the names of its own paused class under
the existing owner policy. Class and company renames appear on the next read
without rewriting the asset's combined name. See
[the decision](../decisions.md#the-signed-in-app).

A holding is written from the chain (`balanceOf`) wherever the platform moves
shares or its settlement asset: the recipient's share holding when an issuance
completes, the recipient's AUDY holding when a deposit's mint executes (each
verified Base wallet registered at that address), and the buyer's and the
seller's share and AUDY holdings when a trade settles. Each write runs after the
work that moved the tokens has committed, so a node that fails at that moment
leaves the issuance, mint or trade complete and the holding unwritten, and none
of these writes creates a holding for a balance of zero. The wallet sync (hourly, and
Sync balances) refreshes every verified holding and then looks for what the
wallet holds without one: the share classes it can hold and the operator's
settlement asset. A share contract credits only an address on its company's
registry, so it reads the deployed classes of the companies that have approved
the wallet, whether or not that approval is still live; the settlement asset,
which anyone can hold, it reads when the operator settles in exactly one
verified asset and the wallet is on the chain the operator settles on. It writes
each positive balance it finds. That recovers a holding a write above could not
make, and tokens sent to the wallet outside the platform. A balance it cannot
read is skipped without failing the sync.

Asset symbols are unique, so when two companies' classes share a symbol the
second asset bridged is stored as the symbol followed by its company's ACN
(`ORD.123456782`), or by part of its contract address when that is taken too.
The stored symbol stays the asset's identity: the API's `assetSymbol`, the asset
admin, the staff transactions list's asset filter and the account export carry
it. Each Activity row (`GET /api/transactions/`) resolves the same `shareClass`
in the same way, and wherever a person reads a class it reads by its own symbol
with its company: Activity's amounts (`40 ORD`, beside the class's combined
name), transaction notices ("100 ORD (Example Pty Ltd)") and the staff lists of
holdings and transactions ("ORD (Example Pty Ltd)"). Crypto keeps its asset symbol, and so
does a class the reader cannot see, such as another company's paused class,
which shows its stored symbol as Holdings shows its combined name.

Neither client's Send picker offers shares. It filters the asset type, so a
paused class with no readable class details stays excluded. Crypto and payment
tokens remain available; the backend continues refusing direct share transfers
with the same instruction to use allotment instead.

## Valuation sources

Portfolio values and new asset snapshots use USD. Asset price writes record
`market` for provider/manual quotes, `nav` for NAV updates, or `par` for the
configured par reference. AUDY uses one AUD per token divided by the stored
USD/AUD exchange rate; seed-only does not create an FX quote. Sync exchange
rates before refreshing asset prices. Without a positive finite rate, a new
AUDY holding remains unpriced. A later provider outage preserves the last
valid cached quote, as it does for market prices; this is not live pricing.
Manual quotes in another currency also require a stored conversion rate.
A cached price whose source is unknown is excluded from current valuations
until a producer refresh or the admin **Update prices** action records it;
direct price, currency and source fields are read-only in the admin. Each
wallet transaction, imported by sync or sent from the app, also records its
USD and AUD values when it is recorded, for
[transaction monitoring](#transaction-monitoring).

## Transaction monitoring

The rules `sync_monitoring_rules` seeds (`backend/compliance/seeds/monitoring_rules.py`)
state their amounts in AUD and are compared with a transaction's AUD value:
MON-001 at AUD 10,000; MON-002 for five transactions within an hour; MON-003
for three of AUD 8,000 to 9,999 within 168 hours; MON-006 at AUD 10,000 for a
new customer without source-of-funds documents; MON-007 at AUD 50,000 within 30
days; MON-008 at AUD 5,000 after 90 days without activity; MON-009 at three
times the customer's 90-day average, given five prior transactions; MON-010 for
three multiples of AUD 5,000 within 30 days; and MON-011 for any transaction by
a customer rated extreme risk. The address rules, MON-004 and MON-005, screen a
transaction of AUD 5,000 or more, and any transaction by a high- or
extreme-risk or new customer.

Each transaction is valued as it is recorded (`transaction_values` in
`backend/assets/services/valuation.py`): the USD value is the amount at the
asset's USD price at the block time, and the AUD value is that converted at the
USD/AUD rate stored at that moment; an asset with an AUD par, AUDY, is valued
at par whatever its USD price. A transfer sent from the app is recorded before
it is mined, so it is valued at the moment it is sent, and wallet sync later
finds the hash already recorded and skips it, so it counts once.
`sync_exchange_rates` refreshes the rate every 10 minutes and no rate history is
kept; the per-transaction rules check only transactions whose block time is
less than an hour old (`TRANSACTION_MONITORING_WINDOW_HOURS`), or that are not
mined yet, so for them it is the rate in effect when they happened. History
imported later, such as a newly verified wallet's past transfers, is converted
at the rate stored when it is imported. A transaction with no USD price, or
recorded while no rate was stored, has no AUD value, and no amount rule counts
it. The windows run on when a transaction happened, its block time or, for a
transfer not mined yet, when it was recorded, so imported history counts when it
happened, not as a burst of recent activity.

A customer is new for 30 days (`NEW_CUSTOMER_DAYS`) after their account first
became active, and an account with no activation date counts as new. The
account records that moment once, whichever path activates it, and the
`users_keep_first_activation` trigger keeps the earliest date through suspension
and reactivation; it can still move earlier, which is how the demo seed dates
its testers from their identity decision.

## NAV updates

The staff YieldToken **Update NAV** form requires `tokens.change_yieldtoken`.
Its signed form identifier belongs to that staff member and token: retrying the
same identifier returns its original outcome, changed values, mode or actor are
refused, and **Start a new NAV update** opens a fresh form for deliberate new
work. Metadata edits save only the edited fields, so an older form cannot
overwrite a NAV that completed while the form was open.

Local-only updates need no chain configuration and commit the NAV audit row,
token valuation, original same-symbol asset and daily snapshot together. Chain
updates first commit a private NAVUpdate and its exact recovery job, then sign
through the [outgoing journal](outgoing-signing.md) after checking current staff
permission, the original target, signer and contract units. An original
successful receipt must contain exactly one NAVUpdated event from the admitted
contract with the admitted new NAV and reserve value; a matching current chain
value is insufficient, because even an equal-value update changes the contract
timestamp. An unresolved chain update reserves the token and contract and
refuses every competing submission, including local-only changes, until
projection completes; the exact job and the periodic `check_pending_nav_updates`
sweep recover it, and the NAV audit page shows its status, transaction hash and
completion. Scheduled NAV price sync locks and rereads the token before locking
the asset, so a captured old quote cannot overwrite a newer completed NAV.
Historical NAV rows stay outside this adapter's admission and recovery; the
[legacy inventory](outgoing-signing.md#legacy-inventory) remains a prerequisite
to activation.

## Portfolio history

There is none. A `Holding` carries only its current quantity: the hourly sync,
history imports and transfer confirmation rewrite that quantity and keep no
dated series of it, and no valuation is computed for a past date. No snapshot
route, holding snapshot or value-series service exists; the portfolios API only
groups wallets. Dashboard and mobile Holdings pages show share quantities by
company and class instead of a portfolio chart.

Next: [wallet transfers](transfers.md), [history and balance reconciliation](../reference/wallet-reconciliation.md),
and [operator seeding](../operations/operator-console.md#seeding).
