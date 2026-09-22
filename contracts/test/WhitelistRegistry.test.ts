import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { WhitelistRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const NO_EXPIRY = 2n ** 64n - 1n;

describe("WhitelistRegistry", function () {
  let whitelist: WhitelistRegistry;
  let owner: SignerWithAddress;
  let investor: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  beforeEach(async function () {
    [owner, investor, nonOwner] = await ethers.getSigners();

    const WhitelistRegistry =
      await ethers.getContractFactory("WhitelistRegistry");
    whitelist = await WhitelistRegistry.deploy(owner.address);
    await whitelist.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await whitelist.owner()).to.equal(owner.address);
    });

    it("Should list nobody initially", async function () {
      expect(await whitelist.expiresAt(investor.address)).to.equal(0);
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });
  });

  describe("Setting an expiry", function () {
    it("Should list an address until its expiry and emit the expiry", async function () {
      const expiry = BigInt(await time.latest()) + 3600n;

      await expect(whitelist.setExpiry(investor.address, expiry))
        .to.emit(whitelist, "ExpirySet")
        .withArgs(investor.address, expiry);

      expect(await whitelist.expiresAt(investor.address)).to.equal(expiry);
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(true);
    });

    it("Should remove an address when the expiry is set to zero", async function () {
      await whitelist.setExpiry(investor.address, NO_EXPIRY);

      await expect(whitelist.setExpiry(investor.address, 0))
        .to.emit(whitelist, "ExpirySet")
        .withArgs(investor.address, 0);

      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });

    it("Should keep an unlimited approval listed far into the future", async function () {
      await whitelist.setExpiry(investor.address, NO_EXPIRY);

      await time.increaseTo(32503680000n);

      expect(await whitelist.isWhitelisted(investor.address)).to.equal(true);
    });

    it("Should stop listing an address once its expiry has passed", async function () {
      const expiry = BigInt(await time.latest()) + 60n;
      await whitelist.setExpiry(investor.address, expiry);

      await time.increaseTo(expiry + 1n);

      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });

    it("Should refuse the zero address", async function () {
      await expect(
        whitelist.setExpiry(ethers.ZeroAddress, NO_EXPIRY),
      ).to.be.revertedWithCustomError(whitelist, "InvalidAddress");
    });
  });

  describe("Owner-only writes", function () {
    it("Should refuse a write from anyone but the owner", async function () {
      await expect(
        whitelist.connect(nonOwner).setExpiry(investor.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(whitelist, "OwnableUnauthorizedAccount");
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });

    it("Should refuse a removal from anyone but the owner", async function () {
      await whitelist.setExpiry(investor.address, NO_EXPIRY);

      await expect(
        whitelist.connect(nonOwner).setExpiry(investor.address, 0),
      ).to.be.revertedWithCustomError(whitelist, "OwnableUnauthorizedAccount");
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(true);
    });

    it("Should move write authority with ownership", async function () {
      await whitelist.transferOwnership(nonOwner.address);

      await expect(
        whitelist.setExpiry(investor.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(whitelist, "OwnableUnauthorizedAccount");
      await whitelist.connect(nonOwner).setExpiry(investor.address, NO_EXPIRY);
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(true);
    });
  });
});
