import { execFileSync } from "node:child_process";
import { artifacts, ethers } from "hardhat";
import {
  CORE_CONTRACTS,
  alignClock,
  configuredCoreAddresses,
  inspectCore,
  readCoreRuntimes,
} from "./local-stack-core";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = configuredCoreAddresses(process.env, deployer.address);
  const runtimes = await readCoreRuntimes(artifacts);
  if (
    (await inspectCore(
      ethers.provider,
      deployer.address,
      addresses,
      runtimes,
    )) === "absent"
  ) {
    console.log("New chain: deploying the core contracts.");
    execFileSync("npm", ["run", "deploy:local:core"], { stdio: "inherit" });
    if (
      (await inspectCore(
        ethers.provider,
        deployer.address,
        addresses,
        runtimes,
      )) !== "present"
    ) {
      throw new Error(
        "The core deployment left no contracts at the configured addresses.",
      );
    }
  }
  for (const [key, { name }] of Object.entries(CORE_CONTRACTS)) {
    console.log(
      `${name} verified at ${addresses[key as keyof typeof addresses]}`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const behind = await alignClock(ethers.provider, now);
  if (behind > 0) {
    console.log(
      `Chain clock set to ${new Date(now * 1000).toISOString()}, ${behind} seconds after the latest block.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
