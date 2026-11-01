# Chains and keys

[Operations](README.md) · [Documentation](../README.md)

How the local development chain, contract ownership and finality settings work.
Public-testnet environment procedures are maintained in private
[Ledova/infra](https://github.com/Ledova/infra/blob/main/docs/deployment.md#public-testnet-environments).
Holding the operator key decides nothing for a company
([company authority](../engineering/README.md#company-authority-boundaries)), and admitting a signer
for a public network needs the owner's explicit direction
([CONTRIBUTING](../../CONTRIBUTING.md#review-and-merge)). The chain variables are in
[configuration](configuration.md#chain).

## Key management

- One key, `BLOCKCHAIN_OPERATOR_KEY`, owns the factory, every company's whitelist registry, the
  AtomicSwap contract and every share token, and signs every deployment, mint, cap change,
  whitelist write and pause. There is no key rotation path in the code: a new key means
  redeploying, or transferring ownership of each contract.
- Keep it outside version control, in the owner-only backend `.env`
  ([environment files](configuration.md#environment-files)); client `.env` values are public.
- For local work use development account #0
  (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`), the first account Hardhat
  and Anvil derive from their public test mnemonic; the local stack configures it. It is public and
  must never hold anything of value.
- `DEPLOYER_PRIVATE_KEY` is the key Hardhat deploys with
  ([contracts](configuration.md#contracts)); export it in the deploying shell for the deployment
  only. Unset against `localhost`, Hardhat uses the node's own accounts; unset against
  `baseSepolia`, the deployment has no signer. The local stack's `chain-deploy` sets it to the
  operator key.
- It is not a second, independent key. `contracts/scripts/deploy-all.ts` passes `deployer.address`
  as the owner of ShareTokenFactory, AUDY and AtomicSwap, and as the AUDY minter. The factory makes
  each share class's owner, which the backend passes as the `BLOCKCHAIN_OPERATOR_KEY` address, the
  owner of that company's registry, and the backend signs every `onlyOwner` call with that key. The
  two keys must therefore resolve to the same address, or ownership of all three contracts must be
  transferred to the operator address after deployment; otherwise every mint, cap change,
  whitelist write and pause reverts.

## Allowed chains and finality

`backend/ledova_backend/chain_safety.py` refuses at startup any chain the
[chain settings](configuration.md#chain) do not allow, and the Hardhat deployment scripts refuse
any chain id outside `{1337, 31337, 84532}`. Mainnet configuration is absent by design.

Only the public testnets have approved finality policies, in the same file: the finalized head on
Base Sepolia (84532) and Ethereum Sepolia (11155111), and six confirmations on the Bitcoin test
network ([how they are applied](../engineering/wallet-protocols.md#wallet-chain-observations)). A
local chain has none, so without `LOCAL_CHAIN_FINALITY_DEPTH` an issuance or swap on it stays
`executing` after its receipt, and a register cannot be opened from it. The setting makes one final
once that many blocks, counted inclusively from the receipt's block, sit on a stable tip. It is
refused when `BLOCKCHAIN_CHAIN_ID` names a public testnet, whose policies stay the approved ones.

## The local stack's chain

`make dev-up` runs the local chain as the Compose service `chain`: Anvil from the Foundry image,
pinned by version and digest, on chain id 31337, published at `http://127.0.0.1:8545`. It mines a
block as each transaction arrives and none in between. Its state lives in the `chain_data` volume,
so contracts, blocks, receipts, logs, timestamps, balances and nonces survive `make dev-down`.
Anvil writes the whole state when Compose stops it and every five seconds while it runs, so a hard
kill can lose up to the last five seconds. Across a restart it keeps every block but not the
account and contract state at earlier blocks, which the backend never needs: with a finality depth
of 1 it reads contract state at the latest block. `make dev-clean` deletes the chain with the
database, and that is the only way to start either over: delete one volume alone and the database
points at contracts or transactions the chain no longer has.

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
with `make dev-clean`. Because Anvil restarts its clock at the latest block's time, the same step
then moves the chain's clock forward to the present, never back, so later blocks do not lag the
wall clock by the time the stack was down.

`docker-compose.yml` gives the `migrate`, `backend` and `worker` services
`BLOCKCHAIN_RPC_URL=http://chain:8545`, `BLOCKCHAIN_CHAIN_ID=31337`, account #0's key as
`BLOCKCHAIN_OPERATOR_KEY`, the three addresses above and `LOCAL_CHAIN_FINALITY_DEPTH=1`, overriding
the local `.env` file in `backend/`. The last step of `migrate` admits that signer for chain 31337
([local chain admission](../engineering/chain.md#local-chain-admission)), so deploying a share
class, approving a wallet, minting, pausing and settling a swap sign and send real transactions on
this chain.

A depth of 1 counts the receipt's own block, so a transaction is final as soon as it is mined. A
deeper wait would protect nothing, since a single node never reorganises, and would stall every
issuance and swap until an unrelated transaction mined the next block.

### Using the local chain from a browser wallet

Add a network with the RPC URL `http://127.0.0.1:8545`, chain id `31337` and currency `ETH`, then
import accounts from the public test mnemonic
`test test test test test test test test test test test junk`. Its first ten accounts hold 10,000
test ether each. The demo data uses five of them:

| Account | Demo use                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| #0      | The operator: the backend's signer, which pays the operator's gas, and the demo founder's wallet |
| #1      | The demo investor's wallet on Base and on Ethereum                                               |
| #2      | The demo investor's wallet on Base, recorded as a Keystone hardware wallet                       |
| #3      | The demo investor's unverified Ethereum wallet                                                   |
| #4      | The demo investor's trading wallet on Base                                                       |

The stack points the `base` network at this chain; Ethereum wallets read Ethereum Sepolia only
when `ALCHEMY_ETH_URL` is set. Never send anything of value to these addresses, avoid sending from
account #0 while the backend is signing, and stop the stack's backend and worker before a backend
on the host signs for account #0 on this chain: only one database should sign for it.

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
the local `.env` file in `backend/` with `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CHAIN_ID=31337`, development account #0's key
as `BLOCKCHAIN_OPERATOR_KEY` and `LOCAL_CHAIN_FINALITY_DEPTH=1`, then run
`python manage.py admit_local_signer` from `backend/`. Hardhat's node keeps nothing after it stops,
so a database that has used it needs a new one with the next node.

`deploy:local:sample-share` (`contracts/scripts/deploy.ts`, local chains only) deploys a factory and a
`DEMO` share class with three whitelisted test accounts and an initial mint. The individual local
scripts read the [deploy-script inputs](configuration.md#contracts).

`make chain-test` is the optional manual smoke: it compiles the contracts, starts its own Hardhat
node on `CHAIN_TEST_PORT` with synthetic accounts, runs one contract smoke and stops the node
([backend verification](../engineering/testing.md#backend-verification)). The port defaults to
8545 and an occupied port is refused, so while the stack is up use another:
`make chain-test CHAIN_TEST_PORT=8546`.

## Reaching the node from Compose

The stack's backend reaches its own chain as `http://chain:8545` on the Compose network, and the
Compose chain settings override the local `.env` file in `backend/`, so point the stack at another node there or in a
Compose override file. For any chain but 31337 the override must also drop `migrate`'s last step,
`admit_local_signer`, which refuses every other chain: otherwise `migrate` exits 1 and `backend`,
`worker` and `dashboard` never start. For a public testnet it must also set
`LOCAL_CHAIN_FINALITY_DEPTH` to empty, because the settings refuse a depth for any chain id but 1337
and 31337: every backend service would fail at startup, and `migrate` at its first step.

A node started on the host is not the backend container's `localhost`: point `BLOCKCHAIN_RPC_URL`
at a host address reachable from the Compose network, or run the node inside that network and use
its service or container name. Host firewall rules can block `host.docker.internal`, as
[document extraction](configuration.md#document-extraction) explains. Restart the
backend and worker after changing their environment.

Next: [jobs and storage](jobs-and-storage.md),
[recovery](recovery.md) or
[outgoing signing](../engineering/chain.md#outgoing-signing-foundation).
