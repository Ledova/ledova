import { getAddress, getCreateAddress, isHexString } from "ethers";
import * as fs from "fs";
import * as path from "path";

const ENVIRONMENT_KEYS = [
  "FRESH_SIGNER_MANIFEST_PATH",
  "FRESH_SIGNER_ENVIRONMENT_ID",
  "FRESH_SIGNER_AUTHORIZATION_REFERENCE",
  "FRESH_SIGNER_ATTEST_FRESH_KEY",
  "FRESH_SIGNER_ATTEST_ISOLATED_ENVIRONMENT",
  "FRESH_SIGNER_ATTEST_PRODUCERS_STOPPED",
] as const;

type CoreAddresses = {
  share_token_factory: string;
  stablecoin: string;
  atomic_swap: string;
};

type RpcProvider = {
  send(method: string, params: unknown[]): Promise<unknown>;
};

export async function prepareFreshSignerDeployment(
  provider: RpcProvider,
  operator: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!ENVIRONMENT_KEYS.some((key) => environment[key] !== undefined)) {
    return undefined;
  }
  for (const key of ENVIRONMENT_KEYS) {
    if (!environment[key]?.trim()) {
      throw new Error(`Fresh signer deployment requires ${key}.`);
    }
  }
  for (const key of ENVIRONMENT_KEYS.slice(3)) {
    if (environment[key] !== "true") {
      throw new Error(`${key} must explicitly be true.`);
    }
  }
  for (const [key, maximum] of [
    ["FRESH_SIGNER_ENVIRONMENT_ID", 200],
    ["FRESH_SIGNER_AUTHORIZATION_REFERENCE", 500],
  ] as const) {
    if ([...environment[key]!.trim()].length > maximum) {
      throw new Error(`${key} must be at most ${maximum} characters.`);
    }
  }
  const manifestPath = environment.FRESH_SIGNER_MANIFEST_PATH!;
  if (!path.isAbsolute(manifestPath)) {
    throw new Error("FRESH_SIGNER_MANIFEST_PATH must be absolute.");
  }
  const operatorAddress = getAddress(operator);
  const chainId = await provider.send("eth_chainId", []);
  if (chainId !== "0x14a34") {
    throw new Error("Fresh signer deployment requires Base Sepolia (84532).");
  }
  const latest = await provider.send("eth_getTransactionCount", [
    operatorAddress,
    "latest",
  ]);
  const pending = await provider.send("eth_getTransactionCount", [
    operatorAddress,
    "pending",
  ]);
  if (latest !== "0x0" || pending !== "0x0") {
    throw new Error(
      "Fresh signer deployment requires an unused operator nonce.",
    );
  }
  if (fs.existsSync(manifestPath)) {
    throw new Error("Fresh signer deployment manifest already exists.");
  }
  const journalPath = `${manifestPath}.journal.json`;
  const manifest = {
    version: 1,
    chain_id: 84532,
    operator_address: operatorAddress,
    environment_id: environment.FRESH_SIGNER_ENVIRONMENT_ID!.trim(),
    authorization_reference:
      environment.FRESH_SIGNER_AUTHORIZATION_REFERENCE!.trim(),
    attestations: {
      fresh_key: true,
      isolated_environment: true,
      producers_stopped: true,
    },
    contracts: {
      share_token_factory: getCreateAddress({
        from: operatorAddress,
        nonce: 0,
      }),
      stablecoin: getCreateAddress({ from: operatorAddress, nonce: 1 }),
      atomic_swap: getCreateAddress({ from: operatorAddress, nonce: 3 }),
    },
    transactions: [] as string[],
  };
  fs.writeFileSync(journalPath, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  let completed = false;
  return {
    recordTransaction(transaction: { hash: string; nonce: number } | null) {
      if (
        completed ||
        !transaction ||
        !isHexString(transaction.hash, 32) ||
        manifest.transactions.includes(transaction.hash) ||
        transaction.nonce !== manifest.transactions.length ||
        manifest.transactions.length >= 5
      ) {
        throw new Error("Fresh deployment transaction order is invalid.");
      }
      manifest.transactions.push(transaction.hash);
      const temporary = `${journalPath}.next`;
      fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      fs.renameSync(temporary, journalPath);
    },
    complete(addresses: CoreAddresses) {
      if (completed || manifest.transactions.length !== 5) {
        throw new Error("Fresh signer deployment is not complete.");
      }
      for (const key of Object.keys(
        manifest.contracts,
      ) as (keyof CoreAddresses)[]) {
        if (getAddress(addresses[key]) !== manifest.contracts[key]) {
          throw new Error("Fresh deployment contract address is unexpected.");
        }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      completed = true;
      return manifestPath;
    },
  };
}
