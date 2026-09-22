# Chain setup and operator keys

[Operations](README.md) · [Documentation](../README.md)

Configure the local chain or Base Sepolia and align deployment ownership with the backend signer.

## Blockchain

| Variable | Default | Required |
| --- | --- | --- |
| `BLOCKCHAIN_RPC_URL` | `ALCHEMY_BASE_URL` if set, else `http://localhost:8545` | Yes for any chain call |
| `BLOCKCHAIN_CHAIN_ID` | `84532` | No; must be one of 1337, 31337, 84532, 11155111 or startup fails |
| `ETHEREUM_CHAIN_ID` | `11155111` | No; same allowed set |
| `BITCOIN_NETWORK` | `test` | No; `test` or `regtest` only |
| `EVM_ASSET_TRANSFER_HISTORY_ENABLED` | `false` | No; enables provider-backed EVM asset transfer history |
| `BLOCKCHAIN_OPERATOR_KEY` | empty | Yes to deploy, mint, whitelist, pause |
| `SHARE_TOKEN_FACTORY_ADDRESS` | empty | Yes for issuance |
| `ATOMIC_SWAP_ADDRESS` | empty | Only for settlement |
| `STABLECOIN_CONTRACT_ADDRESS` | empty | Only for stablecoin payment; seeds the `AUDY` deployment on `base` |
| `SWAP_ORDER_EXPIRY_HOURS` | `0.25` (15 minutes) | No; finite fractional hours are accepted |
| `LOCAL_CHAIN_FINALITY_DEPTH` | empty | No; a positive block depth at which a swap on a local chain (1337, 31337) settles. Refused for any other chain id |

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
- For local work use Hardhat account #0
  (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`). It is
  a public development key and must never hold anything of value.
- `DEPLOYER_PRIVATE_KEY` is the key Hardhat signs the deployment with; it reads
  it from `process.env` into the `localhost` and `baseSepolia` account lists.
  Export it in the deploying shell for the length of the deployment; nothing
  loads it from a file. Leave it unset against `localhost`, where Hardhat falls
  back to the node's own accounts.
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

Local chain, in two terminals from the repository root:

```bash
cd contracts && npx hardhat node          # chain id 31337, port 8545
npm --prefix contracts run deploy:local:core
```

The deployment writes `SHARE_TOKEN_FACTORY_ADDRESS`, `ATOMIC_SWAP_ADDRESS` and
`STABLECOIN_CONTRACT_ADDRESS` to `.deployed-contracts.env`. There is no
deployment-wide whitelist: the factory creates each company's
`WhitelistRegistry` with the company's first share class. Copy them into
`backend/.env` with `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CHAIN_ID=31337` and the
Hardhat account #0 key as `BLOCKCHAIN_OPERATOR_KEY`.

A swap on the local chain stays `executing` after its receipt, because
`evm:31337` has no approved finality policy. To let the local stack settle swaps,
set `LOCAL_CHAIN_FINALITY_DEPTH` (for example `3`) in `backend/.env`; the swap
completes once that many blocks, counted inclusively from the receipt's block,
sit on a stable tip. Hardhat mines one block per transaction, so the depth is
reached only as further transactions or `evm_mine` calls land. The setting is
refused when `BLOCKCHAIN_CHAIN_ID` names a public testnet, whose policies stay
the approved ones in `backend/ledova_backend/chain_safety.py`.

Base Sepolia (chain id 84532) is the supported public testnet:
`npm --prefix contracts run deploy:testnet`, with `DEPLOYER_PRIVATE_KEY` and
`BASE_SEPOLIA_RPC_URL` exported in that shell. The `DEPLOYER_PRIVATE_KEY`
address becomes the owner of all three contracts, so it must be the same signer
as the `BLOCKCHAIN_OPERATOR_KEY` you put in `backend/.env`, or you must transfer
ownership of ShareTokenFactory, AUDY and AtomicSwap to the operator address
immediately after deploying. Otherwise the backend's `onlyOwner` calls revert
against the freshly deployed contracts.

`make chain-test` does the local sequence unattended: it compiles, starts a
node, waits for `eth_chainId`, deploys the core contracts, sources
`.deployed-contracts.env` and runs
`backend/tokens/tests/test_chain_integration.py`, then stops the node.
`CHAIN_TEST_PORT` moves the whole thing — the node, the `localhost` network the
deploy connects to (through `LOCALHOST_RPC_URL`, which
`contracts/hardhat.config.ts` reads) and the backend's `BLOCKCHAIN_RPC_URL` — so
two worktrees can run the chain test at the same time on different ports. The
target refuses to start when that port is already taken, naming the port rather
than failing later with Hardhat's `HH108`.
The chain test uses PostgreSQL. Set `POSTGRES_*` for an isolated database; the
two-worker capital-increase case requires its real row locks.

## Fresh-start redeploy

The per-company registries of [#648](https://github.com/Ledova/ledova/issues/648)
changed the bytecode of every contract, and a deployed share token can never be
rebound to another registry. Moving a deployment onto the new contracts is
therefore a fresh start, [the owner's decision](../decisions.md#company-scoped-approvals):
new contracts and a new database, with nothing carried over and no register
re-anchored. Migration `whitelist/0007_per_company_approvals` refuses to run on
a database that still holds whitelist changes written for the retired global
registry.

1. Stop the backend and the workers, so nothing signs against the old
   contracts.
2. Deploy the core contracts with `deploy-all.ts`: `npm --prefix contracts run
   deploy:local:core` against a local node, or `npm --prefix contracts run
   deploy:testnet` for Base Sepolia with `DEPLOYER_PRIVATE_KEY` and
   `BASE_SEPOLIA_RPC_URL` exported. The deploying key must be the operator key
   ([key management](#key-management)).
3. Reset the database: drop it, create it empty and run `python manage.py
   migrate`, then `check_rls_roles` and `check_rls_catalogue`.
4. Set the three addresses from `.deployed-contracts.env`
   (`SHARE_TOKEN_FACTORY_ADDRESS`, `ATOMIC_SWAP_ADDRESS`,
   `STABLECOIN_CONTRACT_ADDRESS`) in `backend/.env`, and remove any
   `WHITELIST_CONTRACT_ADDRESS` line. Start the backend and the workers.
5. Recreate companies and users through the browser. `createsuperuser` and
   admin wallet verification are the only steps outside it.
6. Deploy each share class. A company's first class creates its registry; its
   later classes share it.
7. Approve wallets for each company in the whitelist admin or through the
   operator API, choosing the company and, for a wallet with no investor
   classification, the expiry to set. A blank expiry means none.
8. Verify:
   - `BLOCKCHAIN_CHAIN_ID` matches the node's `eth_chainId`;
   - for each class, `whitelist()` on its token equals `registryOf(acn)` on the
     factory;
   - a wallet approved only for one company is refused a mint of another
     company's class;
   - revoking a wallet holder's classification removes it from that company's
     registry within fifteen minutes, and its approval then reads `removed`;
   - no share class has a deployment whose factory differs from
     `SHARE_TOKEN_FACTORY_ADDRESS`.

An approval refreshes itself when a classification is revoked or renewed, when
an account is suspended or terminated, and when a wallet is deleted or
relinked: the platform refuses at once and the chain follows within fifteen
minutes. [Refreshing an approval](../architecture/outgoing-signing.md#refreshing-an-approval)
owns the rule, what each status means and what staff must still do by hand.
Until a removal lands on chain, a direct contract call can still move shares,
and pausing the token is the incident lever.

## Reaching the node from Compose

A node started on the host is not the backend container's `localhost`. Point
`BLOCKCHAIN_RPC_URL` at a host address reachable from the Compose network, or
run the node inside that network and use its service/container name. Host firewall
rules can block `host.docker.internal`; [provider networking](integrations.md#document-extraction)
explains that failure. Restart backend and worker after changing their environment.

The public testnet sequence and local sequence both require the deployment key
and backend operator key to identify the configured contract owner.
