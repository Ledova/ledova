import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCreateAddress } from "ethers";
import { prepareFreshSignerDeployment } from "../scripts/fresh-signer-manifest";

describe("Fresh signer deployment manifest", function () {
  const operator = "0x1234567890123456789012345678901234567890";
  let directory: string;
  let environment: NodeJS.ProcessEnv;
  let rpcCalls: string[];
  let chainId: string;
  let latest: string;
  let pending: string;
  const provider = {
    async send(method: string, params: unknown[]) {
      rpcCalls.push(method);
      if (method === "eth_chainId") return chainId;
      assert.equal(method, "eth_getTransactionCount");
      assert.equal(params[0], operator);
      return params[1] === "latest" ? latest : pending;
    },
  };
  const addresses = {
    share_token_factory: getCreateAddress({ from: operator, nonce: 0 }),
    stablecoin: getCreateAddress({ from: operator, nonce: 1 }),
    atomic_swap: getCreateAddress({ from: operator, nonce: 3 }),
  };
  const transaction = (nonce: number) => ({
    nonce,
    hash: `0x${(nonce + 1).toString(16).padStart(64, "0")}`,
  });

  beforeEach(function () {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "ledova-manifest-"));
    environment = {
      FRESH_SIGNER_MANIFEST_PATH: path.join(directory, "manifest.json"),
      FRESH_SIGNER_ENVIRONMENT_ID: "isolated-test-environment",
      FRESH_SIGNER_AUTHORIZATION_REFERENCE: "synthetic-owner-authorization",
      FRESH_SIGNER_ATTEST_FRESH_KEY: "true",
      FRESH_SIGNER_ATTEST_ISOLATED_ENVIRONMENT: "true",
      FRESH_SIGNER_ATTEST_PRODUCERS_STOPPED: "true",
    };
    rpcCalls = [];
    chainId = "0x14a34";
    latest = "0x0";
    pending = "0x0";
  });

  afterEach(function () {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("leaves ordinary deployments unchanged without opt-in metadata", async function () {
    assert.equal(
      await prepareFreshSignerDeployment(provider, operator, {}),
      undefined,
    );
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(fs.readdirSync(directory), []);
  });

  it("requires all explicit attestations before any RPC work", async function () {
    for (const key of Object.keys(environment)) {
      const incomplete = { ...environment };
      delete incomplete[key];
      await assert.rejects(
        prepareFreshSignerDeployment(provider, operator, incomplete),
        /requires/,
      );
    }
    for (const key of Object.keys(environment).filter((key) =>
      key.includes("ATTEST"),
    )) {
      await assert.rejects(
        prepareFreshSignerDeployment(provider, operator, {
          ...environment,
          [key]: "false",
        }),
        /must explicitly be true/,
      );
    }
    assert.deepEqual(rpcCalls, []);
  });

  it("refuses other chains and any confirmed or pending sender activity", async function () {
    for (const unsupported of ["0x1", "0x7a69", "0xaa36a7"]) {
      chainId = unsupported;
      await assert.rejects(
        prepareFreshSignerDeployment(provider, operator, environment),
        /requires Base Sepolia/,
      );
    }
    chainId = "0x14a34";
    latest = "0x1";
    await assert.rejects(
      prepareFreshSignerDeployment(provider, operator, environment),
      /unused operator nonce/,
    );
    latest = "0x0";
    pending = "0x1";
    await assert.rejects(
      prepareFreshSignerDeployment(provider, operator, environment),
      /unused operator nonce/,
    );
    assert.deepEqual(fs.readdirSync(directory), []);
  });

  it("rejects metadata exceeding admission limits before any RPC work", async function () {
    for (const [key, maximum] of [
      ["FRESH_SIGNER_ENVIRONMENT_ID", 200],
      ["FRESH_SIGNER_AUTHORIZATION_REFERENCE", 500],
    ] as const) {
      await assert.rejects(
        prepareFreshSignerDeployment(provider, operator, {
          ...environment,
          [key]: "a".repeat(maximum + 1),
        }),
        /must be at most/,
      );
    }
    assert.deepEqual(rpcCalls, []);
  });

  it("retains partial evidence and refuses a second deployment after interruption", async function () {
    const recorder = (await prepareFreshSignerDeployment(
      provider,
      operator,
      environment,
    ))!;
    recorder.recordTransaction(transaction(0));
    const manifestPath = environment.FRESH_SIGNER_MANIFEST_PATH!;
    assert.equal(fs.existsSync(manifestPath), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(`${manifestPath}.journal.json`, "utf8"))
        .transactions,
      [transaction(0).hash],
    );
    assert.throws(() => recorder.complete(addresses), /not complete/);
    await assert.rejects(
      prepareFreshSignerDeployment(provider, operator, environment),
      /EEXIST/,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(`${manifestPath}.journal.json`, "utf8"))
        .transactions,
      [transaction(0).hash],
    );
  });

  it("rejects a missing, duplicate or out-of-order transaction", async function () {
    const recorder = (await prepareFreshSignerDeployment(
      provider,
      operator,
      environment,
    ))!;
    assert.throws(() => recorder.recordTransaction(null), /order is invalid/);
    assert.throws(
      () => recorder.recordTransaction(transaction(1)),
      /order is invalid/,
    );
    recorder.recordTransaction(transaction(0));
    assert.throws(
      () => recorder.recordTransaction({ ...transaction(0), nonce: 1 }),
      /order is invalid/,
    );
  });

  it("publishes only five ordered transactions at their derived contract addresses", async function () {
    const recorder = (await prepareFreshSignerDeployment(
      provider,
      operator,
      environment,
    ))!;
    for (let nonce = 0; nonce < 5; nonce++) {
      recorder.recordTransaction(transaction(nonce));
    }
    assert.throws(
      () => recorder.complete({ ...addresses, stablecoin: operator }),
      /address is unexpected/,
    );
    const manifestPath = recorder.complete(addresses);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")), {
      version: 1,
      chain_id: 84532,
      operator_address: operator,
      environment_id: "isolated-test-environment",
      authorization_reference: "synthetic-owner-authorization",
      attestations: {
        fresh_key: true,
        isolated_environment: true,
        producers_stopped: true,
      },
      contracts: addresses,
      transactions: [0, 1, 2, 3, 4].map((nonce) => transaction(nonce).hash),
    });
    assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
    assert.throws(() => recorder.complete(addresses), /not complete/);
    assert.throws(
      () => recorder.recordTransaction(transaction(5)),
      /order is invalid/,
    );
    await assert.rejects(
      prepareFreshSignerDeployment(provider, operator, environment),
      /manifest already exists/,
    );
  });
});
