# Chain setup and operator keys

[Operations](README.md) · [Documentation](../README.md)

Configure the local chain or Base Sepolia and align deployment ownership with the backend signer.

This guide describes the current contract ownership and technical signer setup.
Under the accepted [company-managed register plan](../architecture/company-managed-registers.md),
an execution key carrying out a company register decision must act on its exact
company-authorised instruction; possession of that key does not give a human
operator authority to decide
a company's share issue, transfer or correction. The current staff admission
and approval procedures below remain implementation references until replaced.

## Blockchain

| Variable                             | Default                                                 | Required                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKCHAIN_RPC_URL`                 | `ALCHEMY_BASE_URL` if set, else `http://localhost:8545` | Yes for any chain call                                                                                                                                                      |
| `BLOCKCHAIN_CHAIN_ID`                | `84532`                                                 | No; must be one of 1337, 31337, 84532, 11155111 or startup fails                                                                                                            |
| `ETHEREUM_CHAIN_ID`                  | `11155111`                                              | No; same allowed set                                                                                                                                                        |
| `BITCOIN_NETWORK`                    | `test`                                                  | No; `test` or `regtest` only                                                                                                                                                |
| `EVM_ASSET_TRANSFER_HISTORY_ENABLED` | `false`                                                 | No; enables provider-backed EVM asset transfer history                                                                                                                      |
| `BLOCKCHAIN_OPERATOR_KEY`            | empty                                                   | Yes to deploy, mint, whitelist, pause                                                                                                                                       |
| `SHARE_TOKEN_FACTORY_ADDRESS`        | empty                                                   | Yes for issuance                                                                                                                                                            |
| `ATOMIC_SWAP_ADDRESS`                | empty                                                   | Only for settlement                                                                                                                                                         |
| `STABLECOIN_CONTRACT_ADDRESS`        | empty                                                   | Only for stablecoin payment; seeds the `AUDY` deployment on `base`                                                                                                          |
| `SWAP_ORDER_EXPIRY_HOURS`            | `0.25` (15 minutes)                                     | No; finite fractional hours are accepted                                                                                                                                    |
| `LOCAL_CHAIN_FINALITY_DEPTH`         | empty                                                   | No; a positive block depth at which an issuance, swap or register opening on a local chain (1337, 31337) is final. The local stack sets `1`. Refused for any other chain id |

Malformed and non-finite values are refused at settings import. This default
applies when issuing a new swap without an explicit signing window.
Existing stored deadlines and signatures are preserved. An explicit operator
override still takes precedence: remove an older `SWAP_ORDER_EXPIRY_HOURS=24`
override or set it to `0.25` to use the new default for future swaps. The ordinary
order-challenge lifetime remains 300 seconds.

## Key management

- One key, `BLOCKCHAIN_OPERATOR_KEY`, owns the factory, every company's
  whitelist registry, the AtomicSwap contract and every share token, and signs every deployment,
  mint, cap change, whitelist write and pause. There is no key rotation path in
  the code: a new key means redeploying or transferring ownership of each
  contract.
- Keep it outside version control. `.env` files created by
  `scripts/init-local-env.py` are mode 0600 and gitignored.
- For local work use development account #0
  (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`), the
  first account Hardhat and Anvil derive from their public test mnemonic; the
  local stack configures it. It is a public development key and must never hold
  anything of value.
- `DEPLOYER_PRIVATE_KEY` is the key Hardhat signs the deployment with; it reads
  it from `process.env` into the `localhost` and `baseSepolia` account lists.
  Export it in the deploying shell for the length of the deployment; nothing
  loads it from a file. Leave it unset against `localhost`, where Hardhat falls
  back to the node's own accounts. The local stack's `chain-deploy` sets it to
  the operator key, so its deployer and the backend's signer are one address.
- **It is not a second, independent key.**
  `contracts/scripts/deploy-all.ts` passes `deployer.address` as the owner of
  ShareTokenFactory, AUDY and AtomicSwap, and it is also the address added as
  the AUDY minter. The factory makes each share class's owner, which the backend
  passes as the `BLOCKCHAIN_OPERATOR_KEY` address, the owner of that company's
  registry. The backend signs every `onlyOwner` call with
  `BLOCKCHAIN_OPERATOR_KEY`. The two keys must therefore resolve to the
  **same address**, or ownership of all three contracts must be transferred to
  the `BLOCKCHAIN_OPERATOR_KEY` address after deployment. Deploy with one key
  and operate with another, without transferring ownership, and every mint, cap
  change, whitelist write and pause reverts.
- Client `.env` files hold no secrets by construction: `VITE_` and
  `EXPO_PUBLIC_` values are embedded in the shipped bundle.

## Chain configuration

`backend/ledova_backend/chain_safety.py` refuses any EVM chain id outside `{1337, 31337, 84532,
11155111}` and any Bitcoin network other than `test` or `regtest`, at startup.
The Hardhat deployment scripts refuse any chain id outside `{1337, 31337,
84532}`. Mainnet configuration is absent by design.

### The local stack's chain

`make dev-up` runs the local chain as the Compose service `chain`: Anvil from
the Foundry image, pinned by version and digest, on chain id 31337. It mines a
block as each transaction arrives and none in between. Its state lives in the
`chain_data` volume, so contract code, blocks, receipts, event logs, block
timestamps, balances and nonces survive `make dev-down` and the next
`make dev-up`. Anvil writes the whole state when Compose stops it and every
five seconds while it runs, so a hard kill (a power cut, Docker killed) can
lose up to the last five seconds. Across a restart it keeps every block but not
the account and contract state at earlier blocks; under the stack's finality
depth of 1, below, the backend reads contract state at the latest block, so it
never needs them. `make dev-clean` deletes the chain with the database, and that is the
only way to start either over: delete one volume alone and the database points
at contracts or transactions the chain no longer has.

The one-shot `chain-deploy` service, built from `contracts/`, runs before
anything that signs. On a new chain it deploys the core contracts with
`npm run deploy:local:core`, from development account #0 at its nonces 0 to 4,
which puts them at the same three addresses every time:

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| `ShareTokenFactory` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `AUDY`              | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `AtomicSwap`        | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

On every start it then checks them: the code at each address must be the
current build of the contract (outside its immutable values), account #0 must
own all three, mint AUDY and relay swaps, and AtomicSwap must accept AUDY. It
exits non-zero when the chain holds only some of them, when account #0 has sent
transactions without creating them, or when they were built from other sources,
as after a change to `contracts/`. Then `migrate`, `backend`, `worker` and
`dashboard` never start, while `chain`, `postgres`, `redis`, `clamav` and
`marketing` keep running, and the message says to reset with `make dev-clean`.
Anvil restarts its clock at the latest block's time, which would leave every
later block behind the wall clock by the time the stack was down, so the same
step then moves the chain's clock forward to the present. It never moves the
clock back: a chain whose latest block is already at or past the present keeps
its time.

`docker-compose.yml` gives the `migrate`, `backend` and `worker` services
`BLOCKCHAIN_RPC_URL=http://chain:8545`, `BLOCKCHAIN_CHAIN_ID=31337`, account
#0's key as `BLOCKCHAIN_OPERATOR_KEY`, the three addresses above and
`LOCAL_CHAIN_FINALITY_DEPTH=1`, overriding `backend/.env`. The last step of
`migrate` is `python manage.py admit_local_signer`, which admits that signer
for chain 31337 and refuses every other chain id; its checks are described
under [local chain admission](../architecture/outgoing-signing.md#local-chain-admission).
Deploying a share class, approving a wallet, minting, pausing and settling a
swap therefore sign and send real transactions on this chain.

A depth of 1 counts the receipt's own block, so a transaction is final as soon
as it is mined. That is the only depth this chain can reach without more
traffic: it mines no block until the next transaction arrives, so with a depth
of 2 every issuance and swap would wait for an unrelated transaction. A single
node never reorganises, so a deeper wait would protect nothing.

To use the chain from a browser wallet, add a network with the RPC URL
`http://127.0.0.1:8545`, chain id `31337` and currency `ETH`, then import
accounts from the public test mnemonic
`test test test test test test test test test test test junk`. Each of its
first ten accounts holds 10,000 test ether: #0 is the operator, the backend's
signer and the demo issuer wallet, and #1 is the demo investor's wallet. The
[demo seed's chain layer](operator-console.md#demo-data) then gives accounts #1,
#2 and #4, the demo investor's Base wallets, the ether their seeded history
leaves them, between about 0.3 and 2 ETH, so the hourly wallet sync keeps their
balances. It leaves account #0's test ether alone, since the operator pays its
gas from it, and the sync then shows the founder that balance. Avoid
sending from account #0 while the backend is signing, and never send anything
of value to these addresses: their keys are public. Scripts on the host reach
the chain at the same URL, and so can a backend run on the host; but only one
database should sign for account #0 on this chain, and the stack's backend and
worker already do, so stop them first.

### A chain of your own

Outside Compose, start a node and deploy the core contracts, in two terminals
from the repository root:

```bash
cd contracts && npx hardhat node          # chain id 31337, port 8545
npm --prefix contracts run deploy:local:core
```

The stack's chain already holds port 8545; stop the stack first or give
`npx hardhat node` another `--port`, with `LOCALHOST_RPC_URL` set to match for
the deployment. The deployment writes `SHARE_TOKEN_FACTORY_ADDRESS`,
`ATOMIC_SWAP_ADDRESS` and `STABLECOIN_CONTRACT_ADDRESS` to
`.deployed-contracts.env`. There is no deployment-wide whitelist: the factory
creates each company's `WhitelistRegistry` with the company's first share
class. Copy them into `backend/.env` with `BLOCKCHAIN_RPC_URL`,
`BLOCKCHAIN_CHAIN_ID=31337`, development account #0's key as
`BLOCKCHAIN_OPERATOR_KEY` and `LOCAL_CHAIN_FINALITY_DEPTH=1`, then run
`python manage.py admit_local_signer` from `backend/`. Hardhat's node keeps
nothing after it stops, so a database that has used it needs a new one with the
next node.

Only the public testnets have approved finality policies, in
`backend/ledova_backend/chain_safety.py`: the finalized head on Base Sepolia
(84532) and Ethereum Sepolia (11155111), and six confirmations on the Bitcoin
test network. [Transaction evidence](../reference/transaction-evidence.md#wallet-chain-observations)
says how they are applied. `evm:31337` has none, so without
`LOCAL_CHAIN_FINALITY_DEPTH` an issuance or swap on the local chain stays
`executing` after its receipt, and a register cannot be opened from it. The
setting makes one final once that many blocks, counted inclusively from the
receipt's block, sit on a stable tip. It is refused when `BLOCKCHAIN_CHAIN_ID`
names a public testnet, whose policies stay the approved ones.

The backend test settings override any `BLOCKCHAIN_CHAIN_ID` and
`LOCAL_CHAIN_FINALITY_DEPTH` the backend accepts: the suites run on 84532 with
the approved policies, as in CI, and the real-chain modules below set 31337 for
themselves. A value the backend refuses stops the suites, as it stops every
other command. [Backend verification](../development/testing.md#backend-verification)
says what else the suites read from the environment.

Base Sepolia (chain id 84532) is the supported public testnet:
`npm --prefix contracts run deploy:testnet`, with `DEPLOYER_PRIVATE_KEY` and
`BASE_SEPOLIA_RPC_URL` exported in that shell. The `DEPLOYER_PRIVATE_KEY`
address becomes the owner of all three contracts, so it must be the same signer
as the `BLOCKCHAIN_OPERATOR_KEY` you put in `backend/.env`, or you must transfer
ownership of ShareTokenFactory, AUDY and AtomicSwap to the operator address
immediately after deploying. Otherwise the backend's `onlyOwner` calls revert
against the freshly deployed contracts.

The package carries three more npm scripts that neither `deploy:local:core`
nor `deploy:testnet` runs: `deploy:local:sample-share` (`scripts/deploy.ts`,
local chains only) deploys a factory and a `DEMO` share class with three
whitelisted test accounts and an initial mint, and `deploy:testnet:stablecoin`
and `deploy:testnet:atomicswap` deploy `AUDY` and `AtomicSwap` on their own on
Base Sepolia, the latter approving `STABLECOIN_ADDRESS`, `SHARE_TOKEN_ADDRESS`
and `RELAYER_ADDRESS` when they are set. `scripts/deploy-share-token.ts` has
no npm script: `npx hardhat run scripts/deploy-share-token.ts --network
localhost` (or `baseSepolia`) from `contracts/` creates one share class on an
existing `FACTORY_ADDRESS` from the `TOKEN_NAME`, `TOKEN_SYMBOL`,
`COMPANY_ACN`, `AUTHORIZED_SHARES` and `INITIAL_MINT` inputs listed in
[deployment configuration](configuration.md#contracts).

`make chain-test` does the local sequence unattended: it compiles, starts a
node, waits for `eth_chainId`, deploys the core contracts, sources
`.deployed-contracts.env` and runs the real-chain modules,
`tokens.tests.test_chain_integration`, `offerings.tests.test_chain_allotment`,
`wallets.tests.test_submission_chain`, `tokens.tests.test_chain_journey`
(the [demonstration journey](demonstration-journey.md)) and
`shared.tests.test_seed_chain` (the [demo seed's chain layer](operator-console.md#demo-data))
and `tokens.tests.test_company_paid_issue_chain` for genuine paid company issue
authority, original execution and separate Mint/register outcomes,
plus `tokens.tests.test_company_pack_chain.SyntheticCompanyCapitalChainTest`
and `tokens.tests.test_company_pack_chain.SyntheticCompanyPauseChainTest` for
the genuine company capital and pause seed commands and their captured original
jobs. It runs the integration module and the remaining selectors sequentially
in separate fresh test-database lifetimes, preserving case order while bounding
historical-fixture migration churn. It then stops the node. The capital class verifies cap-only execution
without relying on the currently unsupported no-key treasury seed path.
`CHAIN_TEST_PORT` moves the whole thing — the node, the `localhost` network the
deploy connects to (through `LOCALHOST_RPC_URL`, which
`contracts/hardhat.config.ts` reads) and the backend's `BLOCKCHAIN_RPC_URL` — so
two worktrees can run the chain test at the same time on different ports. The
target refuses to start when that port is already taken, naming the port rather
than failing later with Hardhat's `HH108`. The local stack's chain holds 8545,
so while the stack is up run `make chain-test CHAIN_TEST_PORT=8546`, or any
other free port. The chain test keeps its own Hardhat node and test databases
and never touches the stack's chain.
The chain test uses PostgreSQL. Set `POSTGRES_*` for an isolated database; the
two-worker capital-increase case requires its real row locks.

Each real-chain test isolates itself through `isolate_chain`
(`backend/tokens/tests/test_chain_integration.py`): it mines one block at the
wall-clock time, then takes the snapshot its cleanup reverts to. The Hardhat node
moves its clock ahead on `evm_revert`, by the time since the snapshot, and by a
second for every block mined within the same second as the one before it, so
without that first block the clock would run ahead by about the suite's running
time. A trade's settlement deadline, fifteen minutes after the match, is checked
against block time, so the later modules' trades, the seed's among them, would
start to expire on chain once the earlier tests ran longer than that.

## Fresh-start redeploy

This procedure belongs to the retired global-registry contract cutover in #648.
It is not the upgrade procedure for company-managed registers or deployment-mode
retirement. These changes preserve existing companies, registers,
documents, approvals and signed history; see [upgrades](upgrades.md#remaining-company-managed-register-upgrade).

The per-company registries of [#648](https://github.com/Ledova/ledova/issues/648)
changed the bytecode of every contract, and a deployed share token can never be
rebound to another registry. Moving a deployment onto the new contracts is
therefore a fresh start, [the owner's decision](../decisions.md#company-scoped-approvals):
new contracts and a new database, with nothing carried over and no register
re-anchored. The database must be a new, empty one: migration
`whitelist/0007_per_company_approvals` refuses to run where whitelist changes
written for the retired global registry remain, but a database carrying share
classes deployed by a retired factory and no such rows would pass it, and step
8's last check is what catches that.

Steps 6 and 7 both sign, so the owner must explicitly authorize signer
admission for the fresh environment. The narrow Base Sepolia bootstrap below
verifies the five core deployment transactions before first admission; it cannot
reopen an old signer or resolve historical cutover. Local `make chain-test`
continues to establish admission as a synthetic test precondition, and the
local stack's `admit_local_signer` refuses every chain but 31337.

1. Stop the backend, workers and every other producer using the new operator
   key. Prepare a new key used only for this fresh isolated environment; do not
   reuse a signer with previous deployments or sends. Preserve existing database
   volumes and historical evidence separately.
2. For the authorized Base Sepolia deployment, export `DEPLOYER_PRIVATE_KEY`
   and `BASE_SEPOLIA_RPC_URL`. The deploying key must be the backend operator
   key. Also supply all fresh-bootstrap metadata together:

   ```text
   FRESH_SIGNER_MANIFEST_PATH=/ABSOLUTE/PRIVATE/PATH/fresh-signer.json
   FRESH_SIGNER_ENVIRONMENT_ID=UNIQUE_FRESH_ENVIRONMENT
   FRESH_SIGNER_AUTHORIZATION_REFERENCE=OWNER_AUTHORIZATION_REFERENCE
   FRESH_SIGNER_ATTEST_FRESH_KEY=true
   FRESH_SIGNER_ATTEST_ISOLATED_ENVIRONMENT=true
   FRESH_SIGNER_ATTEST_PRODUCERS_STOPPED=true
   ```

   The environment ID and authorization reference are nonempty, at most 200
   and 500 characters. Export the values only after establishing the facts they
   attest. Run `npm --prefix contracts run deploy:testnet`. Fresh mode refuses
   any chain other than 84532, nonzero latest or pending sender nonce, or an
   existing manifest or companion `.journal.json`. It records each returned
   transaction hash before waiting for its receipt, emits the final manifest
   after the five sends complete, and writes the configured addresses to
   `.deployed-contracts.env`. Keep the manifest, journal and compiled
   `contracts/artifacts` directory, including `.dbg.json` and build-info files,
   with the deployment evidence. A partial journal means deployment is incomplete:
   retain it and investigate; do not rerun deployment or erase history to make
   this fresh-only verifier accept the signer. Without fresh metadata, ordinary
   deployment behavior is unchanged and does not produce admission evidence.

3. Configure a separate, newly created empty database. From `backend/`, run
   `python manage.py migrate`, `python manage.py check_rls_roles` and
   `python manage.py check_rls_catalogue` against it. Do not carry old rows into
   this database. A cluster initialized without `POSTGRES_HOST_AUTH_METHOD=trust`
   refuses the passwordless roles the migration creates; `check_rls_roles`
   prints the two `ALTER ROLE` statements that fix it. [Row-level security roles](configuration.md#row-level-security-roles)
   owns the rule.
4. Configure `BLOCKCHAIN_CHAIN_ID=84532`, the authorized provider, the fresh
   `BLOCKCHAIN_OPERATOR_KEY`, and the three `.deployed-contracts.env` addresses
   in `backend/.env`. Remove any `WHITELIST_CONTRACT_ADDRESS` line. Keep the
   backend, workers and all producers stopped. Wait for all five transactions
   to be canonical and finalized, then run from the checkout's `backend/` with
   the retained Hardhat artifacts and manifest accessible:

   ```bash
   python manage.py bootstrap_fresh_signer --manifest /ABSOLUTE/PRIVATE/PATH/fresh-signer.json
   ```

   Success prints the immutable bootstrap UUID, manifest digest and
   `unchanged: false`; exact replay prints `unchanged: true` and does not reset
   an advanced nonce. A verification failure leaves admission closed: resolve
   the reported configuration or evidence problem while retaining the original
   manifest. Evidence refusals identify the zero-based manifest transaction
   index and reason. If the latest head changes during an observation, the
   command reads that transaction's evidence again, up to five attempts total;
   every accepted observation must still have a stable head and pass all receipt
   and finality checks. Other evidence failures are not retried. Exhausted reads
   leave admission closed and do not create a bootstrap record or send transactions.
   The [admission contract](../architecture/outgoing-signing.md#fresh-base-sepolia-admission)
   lists the strict transaction, finality, history and replay checks. This
   command must run before companies, legacy source rows or outgoing operations
   exist. An inventory report does not authorize admission or clear legacy holds.

5. After successful admission, start the backend and workers and recreate
   companies and users through the browser. `createsuperuser` and admin wallet
   verification are the other steps outside it.
6. Deploy each share class. A company's first class creates its registry; its
   later classes share it.
7. Use the [company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md):
   the participant completes ordinary possession proof and explicitly nominates
   one own Base wallet under the exact company's current GENERAL eligibility;
   a current company appointee prepares, approves and applies its finite-expiry
   ADD. Verify the original execution outcome separately from human applied
   status. Staff APIs/admin override and a blank expiry do not substitute for
   that source. Unsupported treasury/broader eligibility has no new admission
   exception. This guide does not direct a live deployment or real-funds use.
8. Verify, from `backend/`. Each command prints its own answer; the expected
   answer follows it. The chain and database probes are read-only; the refresh
   sweep below can sign and broadcast changes.

   ```bash
   python manage.py shell -c "from integrations.base_chain import get_base_chain_client; print(get_base_chain_client().assert_expected_chain())"
   ```

   Prints the chain id, and raises `BaseChainConnectionError` when the node
   disagrees with `BLOCKCHAIN_CHAIN_ID`.

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

   One line per class, every one `True`: the token's own registry is the one
   the factory holds for its company's ACN.

   For isolation, prepare two companies with deployed classes and a control
   wallet approved only for company A. Replace the two class UUIDs and wallet
   address below with that fixture. Missing classes, the same company or a
   shared registry must fail; an empty loop is not evidence of isolation.

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

   Prints the two class UUIDs, their registries, the wallet and `(True, False)`.
   A separate valid approval in B would legitimately make B return `True`:
   that wallet no longer satisfies the A-only fixture. RPC failures must be
   resolved, not interpreted as a refusal.

   The next command runs the normal refresh sweep immediately. It can sign and
   broadcast attributable approval changes, so run it only as part of the
   authorised exercise with signer admission ready. The following query only
   reads the surviving approval rows.

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

   The sweep runs itself every five minutes. `submitted` counts returned
   change submissions, including unsuccessful outcomes; it does not count
   confirmed removals. `unattributed` and `errors` require investigation.
   Inspect the specific change's outcome and transaction, allow pending changes
   to recover, and verify that `is_whitelisted(token_address, wallet_address)`
   returns `False` on chain after revocation. A confirmed removal projects
   `removed`; ordinary expiry can deny membership without changing the stored
   approval to `removed`. Deleted-wallet approvals can disappear, so inspect
   their retained removal jobs through [recovery](recovery.md) instead of
   treating absence from this query as success.

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

[The §5 evidence](approval-controls.md) records the rehearsal of this runbook,
what each check answered, and the place for the authorised Base Sepolia result.

An approval refreshes itself when a classification is revoked or renewed, when
an account is suspended or terminated, and when a wallet is deleted or
relinked: the platform refuses at once and, in normal operation, the chain follows
within fifteen minutes. [Refreshing an approval](../architecture/outgoing-signing.md#refreshing-an-approval)
owns the rule, what each status means and what staff must still do by hand.
Until a removal lands on chain, a direct contract call can still move shares,
and pausing the token is the incident lever.

## Reaching the node from Compose

The stack's backend reaches its own chain as `http://chain:8545` on the
Compose network, and the chain settings in `docker-compose.yml` override
`backend/.env`, so pointing the stack at another node means changing them there
or in a Compose override file. An override for any chain other than 31337 must
also replace `migrate`'s command with one that leaves out its last step:
`admit_local_signer` refuses every other chain, so `migrate` would exit 1 and
`backend`, `worker` and `dashboard` would never start. An override for a public
testnet must also set `LOCAL_CHAIN_FINALITY_DEPTH` to empty: the settings refuse
the stack's depth of 1 for any chain id but 1337 and 31337, so every backend
service would fail at startup and `migrate` at its first step. A node started on the host is not the backend
container's `localhost`: point `BLOCKCHAIN_RPC_URL` at a host address reachable
from the Compose network, or run the node inside that network and use its
service/container name. Host firewall rules can block `host.docker.internal`;
[provider networking](integrations.md#document-extraction) explains that
failure. Restart backend and worker after changing their environment.

The public testnet sequence and local sequence both require the deployment key
and backend operator key to identify the configured contract owner.
