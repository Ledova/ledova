import assert from "node:assert/strict";
import { Wallet, getAddress, toBeHex } from "ethers";
import { artifacts, ethers, network } from "hardhat";
import {
  CoreRuntimes,
  alignClock,
  configuredCoreAddresses,
  expectedCoreAddresses,
  inspectCore,
  readCoreRuntimes,
} from "../scripts/local-stack-core";

describe("Local stack core contracts", function () {
  let runtimes: CoreRuntimes;

  before(async function () {
    runtimes = await readCoreRuntimes(artifacts);
  });

  async function freshDeployer() {
    const deployer = new Wallet(
      Wallet.createRandom().privateKey,
      ethers.provider,
    );
    await network.provider.send("hardhat_setBalance", [
      deployer.address,
      toBeHex(10n ** 20n),
    ]);
    return deployer;
  }

  async function deployCore(deployer: Wallet, transactions = 5) {
    const steps = [
      async () =>
        (await ethers.getContractFactory("ShareTokenFactory", deployer)).deploy(
          deployer.address,
        ),
      async () =>
        (await ethers.getContractFactory("AUDY", deployer)).deploy(
          deployer.address,
        ),
      async (audy: string) =>
        (await ethers.getContractAt("AUDY", audy, deployer)).addMinter(
          deployer.address,
        ),
      async () =>
        (await ethers.getContractFactory("AtomicSwap", deployer)).deploy(
          deployer.address,
        ),
      async (audy: string, swap: string) =>
        (
          await ethers.getContractAt("AtomicSwap", swap, deployer)
        ).setPaymentTokenApproval(audy, true),
    ];
    const addresses = expectedCoreAddresses(deployer.address);
    for (const step of steps.slice(0, transactions)) {
      const sent = await step(addresses.stablecoin, addresses.atomic_swap);
      await ("waitForDeployment" in sent
        ? sent.waitForDeployment()
        : sent.wait());
    }
    return addresses;
  }

  function inspect(
    deployer: Wallet,
    addresses = expectedCoreAddresses(deployer.address),
  ) {
    return inspectCore(ethers.provider, deployer.address, addresses, runtimes);
  }

  it("finds a new chain empty until the five core transactions create the configured contracts", async function () {
    const deployer = await freshDeployer();
    assert.equal(await inspect(deployer), "absent");
    await deployCore(deployer);
    assert.equal(await inspect(deployer), "present");
  });

  it("accepts only the deployer's creation addresses from the environment", function () {
    const deployer = Wallet.createRandom().address;
    const expected = expectedCoreAddresses(deployer);
    const environment = {
      SHARE_TOKEN_FACTORY_ADDRESS: expected.share_token_factory.toLowerCase(),
      STABLECOIN_CONTRACT_ADDRESS: expected.stablecoin,
      ATOMIC_SWAP_ADDRESS: ` ${expected.atomic_swap} `,
    };
    assert.deepEqual(configuredCoreAddresses(environment, deployer), expected);
    assert.throws(
      () =>
        configuredCoreAddresses(
          { ...environment, STABLECOIN_CONTRACT_ADDRESS: expected.atomic_swap },
          deployer,
        ),
      /STABLECOIN_CONTRACT_ADDRESS is .* creates AUDY at/,
    );
    assert.throws(
      () =>
        configuredCoreAddresses(
          { ...environment, ATOMIC_SWAP_ADDRESS: "" },
          deployer,
        ),
      /ATOMIC_SWAP_ADDRESS must name a contract address/,
    );
  });

  it("refuses a node on any chain but 31337", async function () {
    const deployer = Wallet.createRandom().address;
    const reader = {
      getNetwork: async () => ({ chainId: 84532n }),
      getCode: async () => "0x",
      getTransactionCount: async () => 0,
      call: async () => "0x",
    };
    await assert.rejects(
      inspectCore(reader, deployer, expectedCoreAddresses(deployer), runtimes),
      /only to chain 31337; this node is chain 84532/,
    );
  });

  it("refuses a deployer whose transactions created no core contracts", async function () {
    const deployer = await freshDeployer();
    await (await deployer.sendTransaction({ to: deployer.address })).wait();
    await assert.rejects(
      inspect(deployer),
      /none of which created the core contracts/,
    );
  });

  it("refuses a chain holding only some of the core contracts", async function () {
    const deployer = await freshDeployer();
    await deployCore(deployer, 1);
    await assert.rejects(inspect(deployer), /some core contracts but no AUDY/);
  });

  it("refuses contract code built from other sources", async function () {
    const deployer = await freshDeployer();
    const addresses = await deployCore(deployer);
    await network.provider.send("hardhat_setCode", [
      addresses.share_token_factory,
      await ethers.provider.getCode(addresses.stablecoin),
    ]);
    await assert.rejects(
      inspect(deployer),
      /ShareTokenFactory at .* was built from different contract sources/,
    );
  });

  it("refuses contracts another account owns", async function () {
    const deployer = await freshDeployer();
    const addresses = await deployCore(deployer);
    const swap = await ethers.getContractAt(
      "AtomicSwap",
      addresses.atomic_swap,
      deployer,
    );
    await (await swap.transferOwnership(Wallet.createRandom().address)).wait();
    await assert.rejects(
      inspect(deployer),
      new RegExp(
        `AtomicSwap at ${addresses.atomic_swap} is not owned by ${getAddress(deployer.address)}`,
      ),
    );
  });

  it("refuses a deployer that is no longer the AUDY minter", async function () {
    const deployer = await freshDeployer();
    const addresses = await deployCore(deployer);
    const audy = await ethers.getContractAt(
      "AUDY",
      addresses.stablecoin,
      deployer,
    );
    await (await audy.removeMinter(deployer.address)).wait();
    await assert.rejects(inspect(deployer), /is not an AUDY minter/);
  });

  it("refuses a deployer that is no longer the AtomicSwap relayer", async function () {
    const deployer = await freshDeployer();
    const addresses = await deployCore(deployer);
    const swap = await ethers.getContractAt(
      "AtomicSwap",
      addresses.atomic_swap,
      deployer,
    );
    await (await swap.setRelayer(deployer.address, false)).wait();
    await assert.rejects(inspect(deployer), /is not an AtomicSwap relayer/);
  });

  it("moves a chain clock that resumed at its latest block to the present, and never back", async function () {
    const calls: unknown[][] = [];
    const clock = (timestamp: number) => ({
      getBlock: async () => ({ timestamp }),
      send: async (method: string, params: unknown[]) => {
        calls.push([method, ...params]);
        return 0;
      },
    });
    assert.equal(await alignClock(clock(1_000), 1_600), 600);
    assert.deepEqual(calls, [["evm_setTime", 1_600]]);
    assert.equal(await alignClock(clock(1_600), 1_600), 0);
    assert.equal(await alignClock(clock(2_000), 1_600), 0);
    assert.deepEqual(calls, [["evm_setTime", 1_600]]);
  });

  it("refuses a deployment that stopped before approving AUDY for payment", async function () {
    const deployer = await freshDeployer();
    await deployCore(deployer, 4);
    await assert.rejects(inspect(deployer), /does not accept AUDY for payment/);
  });
});
