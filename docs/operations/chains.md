# Chains and keys

[Operations](README.md) · [Documentation](../README.md)

How to run the local chain or a public testnet, align contract ownership with the backend's signer,
and stand up a fresh public-testnet environment. It is for operators and engineers running an
instance. The operator key signs deployments, wallet approvals, mints, capital changes and pauses
only on an exact company decision; holding it decides nothing for a company
([company authority](../engineering/README.md#company-authority-boundaries)), and admitting a signer
for a public network needs the owner's explicit direction
([CONTRIBUTING](../../CONTRIBUTING.md#review-and-merge)). The chain variables are listed under
[configuration](configuration.md#chain).

- [Key management](#key-management)
- [Allowed chains and finality](#allowed-chains-and-finality)
- [The local stack's chain](#the-local-stacks-chain)
- [A chain of your own](#a-chain-of-your-own)
- [Fresh-start redeploy](#fresh-start-redeploy)
- [Fresh signer admission](#fresh-signer-admission)
- [Reaching the node from Compose](#reaching-the-node-from-compose)

## Key management

- One key, `BLOCKCHAIN_OPERATOR_KEY`, owns the factory, every company's whitelist registry, the
  AtomicSwap contract and every share token, and signs every deployment, mint, cap change,
  whitelist write and pause. There is no key rotation path in the code: a new key means
  redeploying, or transferring ownership of each contract.
- Keep it outside version control. The `.env` files `scripts/init-local-env.py` creates are mode
  0600 and gitignored. Client `.env` files hold no secrets by construction: `VITE_` and
  `EXPO_PUBLIC_` values are embedded in the shipped bundle.
- For local work use development account #0
  (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`), the first account Hardhat
  and Anvil derive from their public test mnemonic; the local stack configures it. It is a public
  development key and must never hold anything of value.
- `DEPLOYER_PRIVATE_KEY` is the key Hardhat signs a deployment with, read from `process.env` into
  the `localhost` and `baseSepolia` account lists. Export it in the deploying shell for the length
  of the deployment; nothing loads it from a file. Unset against `localhost`, Hardhat uses the
  node's own accounts; unset against `baseSepolia`, the deployment has no signer. The local stack's
  `chain-deploy` sets it to the operator key, so its deployer and the backend's signer are one
  address.
- It is not a second, independent key. `contracts/scripts/deploy-all.ts` passes `deployer.address`
  as the owner of ShareTokenFactory, AUDY and AtomicSwap, and as the AUDY minter. The factory makes
  each share class's owner, which the backend passes as the `BLOCKCHAIN_OPERATOR_KEY` address, the
  owner of that company's registry, and the backend signs every `onlyOwner` call with
  `BLOCKCHAIN_OPERATOR_KEY`. The two keys must therefore resolve to the same address, or ownership
  of all three contracts must be transferred to the `BLOCKCHAIN_OPERATOR_KEY` address after
  deployment. Deploy with one key and operate with another without transferring ownership, and
  every mint, cap change, whitelist write and pause reverts.

## Allowed chains and finality

`backend/ledova_backend/chain_safety.py` refuses, at startup, any EVM chain id outside
`{1337, 31337, 84532, 11155111}` and any Bitcoin network other than `test` or `regtest`. The Hardhat
deployment scripts refuse any chain id outside `{1337, 31337, 84532}`. Mainnet configuration is
absent by design.

Only the public testnets have approved finality policies, in the same file: the finalized head on
Base Sepolia (84532) and Ethereum Sepolia (11155111), and six confirmations on the Bitcoin test
network. [Transaction evidence](../engineering/wallet-protocols.md#wallet-chain-observations)
says how they are applied. A local chain has none, so without `LOCAL_CHAIN_FINALITY_DEPTH` an
issuance or swap on it stays `executing` after its receipt, and a register cannot be opened from
it. The setting makes one final once that many blocks, counted inclusively from the receipt's
block, sit on a stable tip. It is refused when `BLOCKCHAIN_CHAIN_ID` names a public testnet, whose
policies stay the approved ones.

The backend test settings fix `BLOCKCHAIN_CHAIN_ID=84532` with the approved policies, so an accepted
`LOCAL_CHAIN_FINALITY_DEPTH` has no effect on the suites, while a value the backend refuses stops
them as it stops every other command
([backend verification](../engineering/testing.md#backend-verification)).

## The local stack's chain

`make dev-up` runs the local chain as the Compose service `chain`: Anvil from the Foundry image,
pinned by version and digest, on chain id 31337, published at `http://127.0.0.1:8545`. It mines a
block as each transaction arrives and none in between. Its state lives in the `chain_data` volume,
so contract code, blocks, receipts, event logs, block timestamps, balances and nonces survive
`make dev-down` and the next `make dev-up`. Anvil writes the whole state when Compose stops it and
every five seconds while it runs, so a hard kill (a power cut, Docker killed) can lose up to the
last five seconds. Across a restart it keeps every block but not the account and contract state at
earlier blocks; with the stack's finality depth of 1 the backend reads contract state at the latest
block, so it never needs them. `make dev-clean` deletes the chain with the database, and that is the
only way to start either over: delete one volume alone and the database points at contracts or
transactions the chain no longer has.

The one-shot `chain-deploy` service, built from `contracts/`, runs `npm run deploy:local:stack`
before anything that signs. On a new chain that wrapper deploys the core contracts through
`deploy:local:core`, from development account #0 at its nonces 0 to 4, which puts them at the same
three addresses every time:

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| `ShareTokenFactory` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `AUDY`              | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `AtomicSwap`        | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

On every start it then checks them: the code at each address must be the current build of the
contract (outside its immutable values), account #0 must own all three, mint AUDY and relay swaps,
and AtomicSwap must accept AUDY. It exits non-zero when the chain holds only some of them, when
account #0 has sent transactions without creating them, or when they were built from other sources,
as after a change to `contracts/`. Then `migrate`, `backend`, `worker` and `dashboard` never start,
while `chain`, `postgres`, `redis`, `clamav` and `site` keep running, and the message says to reset
with `make dev-clean`. Anvil restarts its clock at the latest block's time, which would leave every
later block behind the wall clock by the time the stack was down, so the same step moves the
chain's clock forward to the present. It never moves the clock back: a chain whose latest block is
already at or past the present keeps its time.

`docker-compose.yml` gives the `migrate`, `backend` and `worker` services
`BLOCKCHAIN_RPC_URL=http://chain:8545`, `BLOCKCHAIN_CHAIN_ID=31337`, account #0's key as
`BLOCKCHAIN_OPERATOR_KEY`, the three addresses above and `LOCAL_CHAIN_FINALITY_DEPTH=1`, overriding
`backend/.env`. The last step of `migrate` is `python manage.py admit_local_signer`, which admits
that signer for chain 31337 and refuses every other chain id
([local chain admission](../engineering/chain.md#local-chain-admission)). Deploying
a share class, approving a wallet, minting, pausing and settling a swap therefore sign and send
real transactions on this chain.

A depth of 1 counts the receipt's own block, so a transaction is final as soon as it is mined. That
is the only depth this chain can reach without more traffic: it mines no block until the next
transaction arrives, so with a depth of 2 every issuance and swap would wait for an unrelated
transaction. A single node never reorganises, so a deeper wait would protect nothing.

### Using the local chain from a browser wallet

Add a network with the RPC URL `http://127.0.0.1:8545`, chain id `31337` and currency `ETH`, then
import accounts from the public test mnemonic
`test test test test test test test test test test test junk`. Its first ten accounts hold 10,000
test ether each. The demo data uses five of them:

| Account | Demo use |
| --- | --- |
| #0 | The operator: the backend's signer, which pays the operator's gas, and the demo founder's wallet |
| #1 | The demo investor's wallet on Base and on Ethereum |
| #2 | The demo investor's wallet on Base, recorded as a Keystone hardware wallet |
| #3 | The demo investor's unverified Ethereum wallet |
| #4 | The demo investor's trading wallet on Base |

The stack points the `base` network at this chain; Ethereum wallets read Ethereum Sepolia only
when `ALCHEMY_ETH_URL` is set. Never send anything of value to these addresses, avoid sending from
account #0 while the backend is signing, and stop the stack's backend and worker before a backend
on the host signs for account #0 on this chain: only one database should sign for it.

While the stack is up the chain holds port 8545, so give the chain smoke test another port:
`make chain-test CHAIN_TEST_PORT=8546`.

## A chain of your own

Outside Compose, start a node and deploy the core contracts, in two terminals from the repository
root:

```bash
cd contracts && npx hardhat node          # chain id 31337, port 8545
npm --prefix contracts run deploy:local:core
```

`make contracts-deploy-local` runs the second command against `CHAIN_TEST_PORT`. The stack's chain
already holds port 8545; stop the stack first, or give `npx hardhat node` another `--port` with
`LOCALHOST_RPC_URL` set to match for the deployment. The deployment writes
`SHARE_TOKEN_FACTORY_ADDRESS`, `ATOMIC_SWAP_ADDRESS` and `STABLECOIN_CONTRACT_ADDRESS` to
`.deployed-contracts.env`. There is no deployment-wide whitelist: the factory creates each
company's `WhitelistRegistry` with the company's first share class. Copy the three addresses into
`backend/.env` with `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CHAIN_ID=31337`, development account #0's key
as `BLOCKCHAIN_OPERATOR_KEY` and `LOCAL_CHAIN_FINALITY_DEPTH=1`, then run
`python manage.py admit_local_signer` from `backend/`. Hardhat's node keeps nothing after it stops,
so a database that has used it needs a new one with the next node.

Base Sepolia (chain id 84532) is the supported public testnet:
`npm --prefix contracts run deploy:testnet` (or `make contracts-deploy-testnet`), with
`DEPLOYER_PRIVATE_KEY` and `BASE_SEPOLIA_RPC_URL` exported in that shell. The deployer must be the
backend's operator key ([key management](#key-management)).

The package carries three more npm scripts that neither `deploy:local:core` nor `deploy:testnet`
runs. `deploy:local:sample-share` (`scripts/deploy.ts`, local chains only) deploys a factory and a
`DEMO` share class with three whitelisted test accounts and an initial mint.
`deploy:testnet:stablecoin` and `deploy:testnet:atomicswap` deploy `AUDY` and `AtomicSwap` on their
own on Base Sepolia, the latter approving `STABLECOIN_ADDRESS`, `SHARE_TOKEN_ADDRESS` and
`RELAYER_ADDRESS` when they are set. `scripts/deploy-share-token.ts` has no npm script:
`npx hardhat run scripts/deploy-share-token.ts --network localhost` (or `baseSepolia`) from
`contracts/` creates one share class on an existing `FACTORY_ADDRESS` from the `TOKEN_NAME`,
`TOKEN_SYMBOL`, `COMPANY_ACN`, `AUTHORIZED_SHARES` and `INITIAL_MINT` inputs.

`make chain-test` is the optional manual smoke: it compiles the contracts, starts its own Hardhat
node on `CHAIN_TEST_PORT` (default 8545, refusing an occupied port) with synthetic accounts, runs
one contract smoke and stops the node
([backend verification](../engineering/testing.md#backend-verification)).

## Fresh-start redeploy

This procedure stands up a fresh public-testnet environment on the per-company contracts: new
contracts and a new, empty database, with nothing carried over and no register re-anchored, as
[the owner decided](../decisions.md#company-scoped-approvals) when every contract's bytecode
changed. The [approval controls](approval-controls.md#base-sepolia) record the
local rehearsal of this procedure, what each check answered, and the authorised Base Sepolia run of
25 September 2026.

Steps 6 and 7 sign, so the owner must explicitly authorise signer admission for the fresh
environment. The bootstrap in step 4 verifies the five core deployment transactions before first
admission and cannot reopen an old signer, and the local stack's `admit_local_signer` refuses every
chain but 31337. The fresh migrations install the current PostgreSQL guards on the empty database
but do not check whether stored classes belong to a retired factory; step 8 does.

1. Stop the backend, workers and every other producer using the new operator key. Prepare a new
   key used only for this fresh, isolated environment; do not reuse a signer with previous
   deployments or sends. Preserve existing database volumes and historical evidence separately.
2. Export `DEPLOYER_PRIVATE_KEY` (the backend operator key) and `BASE_SEPOLIA_RPC_URL`, and supply
   all the fresh-bootstrap metadata together, only after establishing the facts it attests:

   ```text
   FRESH_SIGNER_MANIFEST_PATH=/ABSOLUTE/PRIVATE/PATH/fresh-signer.json
   FRESH_SIGNER_ENVIRONMENT_ID=UNIQUE_FRESH_ENVIRONMENT
   FRESH_SIGNER_AUTHORIZATION_REFERENCE=OWNER_AUTHORIZATION_REFERENCE
   FRESH_SIGNER_ATTEST_FRESH_KEY=true
   FRESH_SIGNER_ATTEST_ISOLATED_ENVIRONMENT=true
   FRESH_SIGNER_ATTEST_PRODUCERS_STOPPED=true
   ```

   Run `npm --prefix contracts run deploy:testnet`. Fresh mode refuses any chain other than 84532,
   a nonzero latest or pending sender nonce, a manifest path that is not absolute, or an existing
   manifest or companion `.journal.json`. It records each transaction hash before waiting for its
   receipt, writes the manifest after the five sends complete, and writes the addresses to
   `.deployed-contracts.env`. Keep the manifest, the journal and the compiled `contracts/artifacts`
   directory, including `.dbg.json` and build-info files, with the deployment evidence. A partial
   journal means the deployment is incomplete: retain it and investigate; do not rerun the
   deployment or erase history to make the verifier accept the signer. Without fresh metadata,
   ordinary deployment behaviour is unchanged and produces no admission evidence.
3. Configure a separate, newly created empty database. From `backend/`, run
   `python manage.py migrate`, `python manage.py check_rls_roles` and
   `python manage.py check_rls_catalogue` against it, carrying no old rows into it. A cluster
   initialised without `POSTGRES_HOST_AUTH_METHOD=trust` refuses the passwordless roles the
   migration creates; [row-level security roles](configuration.md#row-level-security-roles)
   gives the fix.
4. Configure `BLOCKCHAIN_CHAIN_ID=84532`, the authorised provider, the fresh
   `BLOCKCHAIN_OPERATOR_KEY` and the three `.deployed-contracts.env` addresses in `backend/.env`.
   Keep the backend, workers and all producers stopped. Wait for all five transactions to be
   canonical and finalized, then run from `backend/`, with the retained Hardhat artifacts and
   manifest accessible:

   ```bash
   python manage.py bootstrap_fresh_signer --manifest /ABSOLUTE/PRIVATE/PATH/fresh-signer.json
   ```

   Success prints the immutable bootstrap UUID, the manifest digest and `unchanged: false`; an
   exact replay prints `unchanged: true`. A verification failure leaves admission closed and
   creates no bootstrap record: resolve the reported problem while retaining the original manifest.
   [Fresh signer admission](#fresh-signer-admission) lists what the
   command checks.
5. After successful admission, start the backend and workers and recreate companies and users
   through the browser. `createsuperuser` and admin wallet verification are the other steps outside
   it.
6. Deploy each share class. A company's first class creates its registry; its later classes share
   it.
7. Approve wallets through the
   [company wallet workflow](../business/participants.md#wallet-nominations-and-company-wallet-approvals):
   the participant nominates a wallet whose possession it has proved, and a company appointee
   prepares, approves and applies a finite-expiry ADD. Staff APIs, admin overrides and a blank
   expiry do not substitute for that source.
8. Verify, from `backend/`. Each command prints its own answer; the expected answer follows it. The
   chain and database probes are read-only; the refresh sweep below can sign and broadcast changes.

   ```bash
   python manage.py shell -c "from integrations.base_chain import get_base_chain_client; print(get_base_chain_client().assert_expected_chain())"
   ```

   Prints the chain id, and raises `BaseChainConnectionError` when the node disagrees with
   `BLOCKCHAIN_CHAIN_ID`.

   ```bash
   python manage.py shell -c "
   from shared.db import use_operator
   from tokens.models import ShareToken
   from whitelist.services.whitelist import registry_for, token_registry
   with use_operator():
       tokens = list(ShareToken.objects.on_chain().select_related('company'))
   if not tokens:
       raise SystemExit('No deployed share classes: the binding check has no fixtures.')
   for token in tokens:
       matches = token_registry(token.contract_address).lower() == registry_for(token.company)
       print(token.pk, token.symbol, matches)
       if not matches:
           raise SystemExit('The token registry does not match its company registry.')
   "
   ```

   One line per class, every one `True`: the token's own registry is the one the factory holds for
   its company's ACN.

   For isolation, prepare two companies with deployed classes and a control wallet approved only
   for company A. Replace the two class UUIDs and the wallet address below with that fixture.
   Missing classes, the same company or a shared registry must fail; an empty loop is not evidence
   of isolation.

   ```bash
   python manage.py shell -c "
   from shared.db import use_operator
   from tokens.models import ShareToken
   from whitelist.services.whitelist import is_whitelisted, token_registry
   with use_operator():
       classes = ShareToken.objects.on_chain().select_related('company')
       company_a = classes.get(pk='COMPANY_A_CLASS_UUID')
       company_b = classes.get(pk='COMPANY_B_CLASS_UUID')
   if company_a.company_id == company_b.company_id:
       raise SystemExit('Choose classes belonging to two different companies.')
   registry_a = token_registry(company_a.contract_address).lower()
   registry_b = token_registry(company_b.contract_address).lower()
   if registry_a == registry_b:
       raise SystemExit('The two companies must have distinct registries.')
   wallet = 'WALLET_APPROVED_ONLY_FOR_COMPANY_A'
   observed = (is_whitelisted(company_a.contract_address, wallet), is_whitelisted(company_b.contract_address, wallet))
   print(company_a.pk, registry_a, company_b.pk, registry_b, wallet, observed)
   if observed != (True, False):
       raise SystemExit('The A-only control wallet must be approved in A and refused in B.')
   "
   ```

   Prints the two class UUIDs, their registries, the wallet and `(True, False)`. A separate valid
   approval in B would legitimately make B return `True`: that wallet no longer satisfies the
   A-only fixture. RPC failures must be resolved, not read as a refusal.

   The next command runs the normal refresh sweep immediately. It can sign and broadcast
   attributable approval changes, so run it only as part of the authorised exercise with signer
   admission ready. The query after it only reads the surviving approval rows.

   ```bash
   python manage.py shell -c "
   from shared.db import use_operator
   from whitelist.services import refresh
   with use_operator():
       print(refresh.sweep())
   "
   python manage.py shell -c "
   from shared.db import use_operator
   from whitelist.models import WhitelistApproval
   with use_operator():
       for approval in WhitelistApproval.objects.select_related('entry__wallet', 'company'):
           print(approval.pk, approval.company.acn, approval.entry.wallet_address, approval.status, approval.expires_at)
   "
   ```

   The sweep also runs every five minutes; `unattributed` and `errors` need investigation, and
   [refreshing an approval](../engineering/chain.md#refreshing-an-approval) gives
   each status's meaning, the removal rule, its window and the incident lever. Deleted-wallet
   approvals can disappear from this query while their removal jobs still run
   ([whitelist changes](recovery.md#whitelist-changes)), so absence is not
   success.

   ```bash
   python manage.py shell -c "
   from django.conf import settings
   from shared.db import use_operator
   from tokens.models import TokenDeployment
   with use_operator():
       print([str(d.pk) for d in TokenDeployment.objects.exclude(contract_address='') if d.intent['to'] != settings.SHARE_TOKEN_FACTORY_ADDRESS.lower()])
   "
   ```

   Prints `[]`: no share class carries a deployment made by another factory.

### Fresh signer admission

`bootstrap_fresh_signer --manifest PATH` is an operator command for the owner's explicitly
authorised fresh environment. It reads the chain and commits local admission; it never signs or
sends a transaction. It must run before application processes, workers, companies, legacy source
rows or outgoing records exist. The deploying key must be unused before the five core deployment
sends, exclusive to this environment, and the configured backend operator key.

The version-1 JSON manifest has exactly `version`, `chain_id`, `operator_address`,
`environment_id`, `authorization_reference`, `attestations`, `contracts` and `transactions`.
Version is integer `1`, chain is integer `84532`, and the environment and authorisation strings are
nonempty and at most 200 and 500 characters. The three attestations are exactly `fresh_key`,
`isolated_environment` and `producers_stopped`, all literal `true`. Contracts are exactly
`share_token_factory`, `stablecoin` and `atomic_swap`, with distinct nonzero lowercase or
checksummed addresses. Transactions are five distinct hashes in deployment order. Unknown or
duplicate JSON keys are refused. Addresses and hashes are normalised to lowercase for the canonical
manifest digest.

The verifier compares the configuration and the configured key's public address, reads the
provider's chain id without the client cache, and requires the exact zero-value transaction
sequence from that sender: nonce 0 creates `ShareTokenFactory(sender)`; nonce 1 creates
`AUDY(sender)`; nonce 2 calls `AUDY.addMinter(sender)`; nonce 3 creates `AtomicSwap(sender)`;
nonce 4 calls `AtomicSwap.setPaymentTokenApproval(AUDY, true)`. Creation bytes come from the local
Hardhat artifacts bound to their build-info, and creation addresses must match the
sender-and-nonce CREATE derivation.

Every receipt must succeed and have complete canonical evidence satisfying the configured
`evm:84532` finalized policy; depth fallback is refused, and receipt identity is fetched again
after evidence collection. Runtime bytecode must match the same build outside compiler-declared
immutable slots, and exact constructor bytes bind those slots' initialisation. Contract owners, the
AUDY minter, the swap relayer and the payment-token approval must match. Both latest and pending
sender nonces must be exactly five. Provider uncertainty, missing artifacts or mismatched evidence
leaves admission closed.

The command refuses legacy source rows, unattributed chain transactions, imported outgoing
evidence, current outgoing operations or attempts, other signer state, and any substantive
inventory hold. The stopped-producer attestation is necessary: opening an unsigned outgoing
operation does not take the signer lock, and the command cannot prove that another process or
offline key holder has stopped, so keep those producers stopped throughout verification and commit.

The final transaction takes a deployment-wide admission lock, then locks the signer and rechecks
database history, so different fresh keys cannot both admit against one apparently empty database.
Only a missing signer, or a closed generation-zero, nonce-zero row, can enter generation one with
next nonce five. The unique bootstrap receipt, manifest digest, artifact and build identities and
chain evidence commit with admission; the receipt is operator-only and PostgreSQL refuses UPDATE or
DELETE on it. An exact manifest replay is recognised before the fresh-history and nonce checks and
returns unchanged only while the same signer remains admitted at generation one; it preserves an
advanced nonce. Closure, any earlier admission or a different manifest cannot be undone through
this command, and the existing close and generation fences remain in force.

### Legacy inventory

`inventory_outgoing_history` reads whatever legacy operator signing history a database holds. It
never signs, contacts a provider, reserves or releases a nonce, or edits a journal or status, and
it refuses an application connection or an enclosing transaction. Run it from `backend/` on the
operator connection:

```bash
python manage.py inventory_outgoing_history
OUTGOING_CAPTURE_ID=$(python -c 'import uuid; print(uuid.uuid4())')
python manage.py inventory_outgoing_history --record --capture-id "$OUTGOING_CAPTURE_ID"
```

The first command only reports. `--record` commits a private capture, its evidence rows and
append-only cutover holds together under an advisory lock. Re-entering the same capture id with
unchanged source returns the original batch; changed source needs a new id, and a later capture can
add variants and holds but never rewrites an earlier observation or clears its holds. Reports carry
counts and fixed reason codes (`missing_chain_provenance`, `missing_signer_authorization`,
`missing_raw_payload`) and always say `cutover_authorized: false`. Raw payloads and source
snapshots are operator-only, and PostgreSQL refuses even operator UPDATE or DELETE on the three
inventory tables.

The bootstrap refuses while any evidence row, any hold beyond the two permanent coverage
limitations, or any legacy source row exists. Empty captures can keep those coverage limitations;
they confer no authority. A [rebuilt database](README.md#rebuild-a-database)
carries no legacy signer history, so the inventory is the emptiness check, not a cutover path:
offline or old-binary key use is not observable in these tables, and no capture authorises
activation.

## Reaching the node from Compose

The stack's backend reaches its own chain as `http://chain:8545` on the Compose network, and the
chain settings in `docker-compose.yml` override `backend/.env`, so pointing the stack at another
node means changing them there or in a Compose override file. An override for any chain other than
31337 must also replace `migrate`'s command with one that leaves out its last step:
`admit_local_signer` refuses every other chain, so `migrate` would exit 1 and `backend`, `worker`
and `dashboard` would never start. An override for a public testnet must also set
`LOCAL_CHAIN_FINALITY_DEPTH` to empty: the settings refuse the stack's depth of 1 for any chain id
but 1337 and 31337, so every backend service would fail at startup and `migrate` at its first step.

A node started on the host is not the backend container's `localhost`: point `BLOCKCHAIN_RPC_URL`
at a host address reachable from the Compose network, or run the node inside that network and use
its service or container name. Host firewall rules can block `host.docker.internal`, as
[document extraction](configuration.md#document-extraction) explains. Restart the
backend and worker after changing their environment.

Next: [jobs and storage](jobs-and-storage.md),
[recovery](recovery.md) or
[outgoing signing](../engineering/chain.md#outgoing-signing-foundation).
