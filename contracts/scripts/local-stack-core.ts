import { Interface, getAddress, getCreateAddress } from "ethers";
import type { Artifacts } from "hardhat/types";

export const LOCAL_STACK_CHAIN_ID = 31337n;

export const CORE_CONTRACTS = {
  share_token_factory: {
    name: "ShareTokenFactory",
    setting: "SHARE_TOKEN_FACTORY_ADDRESS",
    nonce: 0,
  },
  stablecoin: {
    name: "AUDY",
    setting: "STABLECOIN_CONTRACT_ADDRESS",
    nonce: 1,
  },
  atomic_swap: { name: "AtomicSwap", setting: "ATOMIC_SWAP_ADDRESS", nonce: 3 },
} as const;

export type CoreKey = keyof typeof CORE_CONTRACTS;
export type CoreAddresses = Record<CoreKey, string>;
export type CoreRuntime = {
  deployedBytecode: string;
  immutableReferences: Record<string, { start: number; length: number }[]>;
};
export type CoreRuntimes = Record<CoreKey, CoreRuntime>;
export type ChainReader = {
  getNetwork(): Promise<{ chainId: bigint }>;
  getCode(address: string): Promise<string>;
  getTransactionCount(address: string, blockTag: string): Promise<number>;
  call(transaction: { to: string; data: string }): Promise<string>;
};
export type ChainClock = {
  getBlock(blockTag: "latest"): Promise<{ timestamp: number } | null>;
  send(method: string, params: unknown[]): Promise<unknown>;
};

const KEYS = Object.keys(CORE_CONTRACTS) as CoreKey[];
const RESET = "make dev-clean resets the local chain and database together.";
const READS = new Interface([
  "function owner() view returns (address)",
  "function minters(address) view returns (bool)",
  "function relayers(address) view returns (bool)",
  "function approvedPaymentTokens(address) view returns (bool)",
]);

export function expectedCoreAddresses(deployer: string): CoreAddresses {
  return Object.fromEntries(
    KEYS.map((key) => [
      key,
      getCreateAddress({ from: deployer, nonce: CORE_CONTRACTS[key].nonce }),
    ]),
  ) as CoreAddresses;
}

export function configuredCoreAddresses(
  environment: NodeJS.ProcessEnv,
  deployer: string,
): CoreAddresses {
  const expected = expectedCoreAddresses(deployer);
  for (const key of KEYS) {
    const { name, setting } = CORE_CONTRACTS[key];
    let configured: string;
    try {
      configured = getAddress(environment[setting]?.trim() ?? "");
    } catch {
      throw new Error(`${setting} must name a contract address.`);
    }
    if (configured !== expected[key]) {
      throw new Error(
        `${setting} is ${configured}, but ${getAddress(deployer)} creates ${name} at ${expected[key]} on a new chain.`,
      );
    }
  }
  return expected;
}

export async function readCoreRuntimes(
  artifacts: Artifacts,
): Promise<CoreRuntimes> {
  const runtimes = {} as CoreRuntimes;
  for (const key of KEYS) {
    const artifact = await artifacts.readArtifact(CORE_CONTRACTS[key].name);
    const build = await artifacts.getBuildInfo(
      `${artifact.sourceName}:${artifact.contractName}`,
    );
    const output =
      build?.output.contracts[artifact.sourceName]?.[artifact.contractName];
    if (output === undefined) {
      throw new Error(`The build of ${artifact.contractName} is missing.`);
    }
    runtimes[key] = {
      deployedBytecode: artifact.deployedBytecode,
      immutableReferences:
        output.evm.deployedBytecode.immutableReferences ?? {},
    };
  }
  return runtimes;
}

function withoutImmutables(code: string, runtime: CoreRuntime): string {
  const digits = code.toLowerCase().replace(/^0x/, "").split("");
  for (const references of Object.values(runtime.immutableReferences)) {
    for (const { start, length } of references) {
      digits.fill("0", start * 2, (start + length) * 2);
    }
  }
  return digits.join("");
}

async function read(
  chain: ChainReader,
  to: string,
  name: string,
  args: unknown[] = [],
): Promise<unknown> {
  const data = READS.encodeFunctionData(name, args);
  return READS.decodeFunctionResult(name, await chain.call({ to, data }))[0];
}

export async function inspectCore(
  chain: ChainReader,
  deployer: string,
  addresses: CoreAddresses,
  runtimes: CoreRuntimes,
): Promise<"absent" | "present"> {
  const { chainId } = await chain.getNetwork();
  if (chainId !== LOCAL_STACK_CHAIN_ID) {
    throw new Error(
      `The local stack deploys only to chain ${LOCAL_STACK_CHAIN_ID}; this node is chain ${chainId}.`,
    );
  }
  const owner = getAddress(deployer);
  const codes = await Promise.all(
    KEYS.map((key) => chain.getCode(addresses[key])),
  );
  const sent = await chain.getTransactionCount(owner, "latest");
  if (codes.every((code) => code === "0x")) {
    if (sent !== 0) {
      throw new Error(
        `${owner} has sent ${sent} transactions on this chain, none of which created the core contracts. ${RESET}`,
      );
    }
    return "absent";
  }
  for (const [index, key] of KEYS.entries()) {
    const { name } = CORE_CONTRACTS[key];
    if (codes[index] === "0x") {
      throw new Error(
        `This chain has some core contracts but no ${name} at ${addresses[key]}. ${RESET}`,
      );
    }
    if (
      withoutImmutables(codes[index], runtimes[key]) !==
      withoutImmutables(runtimes[key].deployedBytecode, runtimes[key])
    ) {
      throw new Error(
        `The ${name} at ${addresses[key]} was built from different contract sources. ${RESET}`,
      );
    }
  }
  for (const key of KEYS) {
    if (
      getAddress((await read(chain, addresses[key], "owner")) as string) !==
      owner
    ) {
      throw new Error(
        `The ${CORE_CONTRACTS[key].name} at ${addresses[key]} is not owned by ${owner}. ${RESET}`,
      );
    }
  }
  if ((await read(chain, addresses.stablecoin, "minters", [owner])) !== true) {
    throw new Error(`${owner} is not an AUDY minter. ${RESET}`);
  }
  if (
    (await read(chain, addresses.atomic_swap, "relayers", [owner])) !== true
  ) {
    throw new Error(`${owner} is not an AtomicSwap relayer. ${RESET}`);
  }
  if (
    (await read(chain, addresses.atomic_swap, "approvedPaymentTokens", [
      addresses.stablecoin,
    ])) !== true
  ) {
    throw new Error(`AtomicSwap does not accept AUDY for payment. ${RESET}`);
  }
  return "present";
}

export async function alignClock(
  chain: ChainClock,
  now: number,
): Promise<number> {
  const head = await chain.getBlock("latest");
  if (head === null) {
    throw new Error("The chain has no latest block.");
  }
  if (head.timestamp >= now) {
    return 0;
  }
  await chain.send("evm_setTime", [now]);
  return now - head.timestamp;
}
