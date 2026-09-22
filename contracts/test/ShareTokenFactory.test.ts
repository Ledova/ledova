import { expect } from "chai";
import { ethers } from "hardhat";
import {
  ShareToken,
  ShareTokenFactory,
  WhitelistRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const NO_EXPIRY = 2n ** 64n - 1n;
const ACN_A = "123456789";
const ACN_B = "987654321";

describe("ShareTokenFactory", function () {
  let factory: ShareTokenFactory;
  let owner: SignerWithAddress;
  let company1: SignerWithAddress;
  let company2: SignerWithAddress;
  let investor: SignerWithAddress;
  let other: SignerWithAddress;

  async function createToken(
    symbol: string,
    acn: string,
    tokenOwner: SignerWithAddress,
  ): Promise<ShareToken> {
    await factory.createShareToken(
      `${symbol} Shares`,
      symbol,
      `${acn}:${symbol}`,
      acn,
      1000000n,
      tokenOwner.address,
    );
    return ethers.getContractAt(
      "ShareToken",
      await factory.getTokenByIdentifier(`${acn}:${symbol}`),
    );
  }

  async function registryOf(acn: string): Promise<WhitelistRegistry> {
    return ethers.getContractAt(
      "WhitelistRegistry",
      await factory.registryOf(acn),
    );
  }

  beforeEach(async function () {
    [owner, company1, company2, investor, other] = await ethers.getSigners();

    const ShareTokenFactory =
      await ethers.getContractFactory("ShareTokenFactory");
    factory = await ShareTokenFactory.deploy(owner.address);
    await factory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should start with zero deployed tokens and no registries", async function () {
      expect(await factory.getDeployedTokenCount()).to.equal(0);
      expect(await factory.registryOf(ACN_A)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Creating ShareTokens", function () {
    const tokenParams = {
      name: "Test Company Shares",
      symbol: "TEST",
      identifier: `${ACN_A}:TEST`,
      acn: ACN_A,
      authorizedShares: 1000000n,
    };

    it("Should create a new ShareToken", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          tokenParams.identifier,
          tokenParams.acn,
          tokenParams.authorizedShares,
          company1.address,
        ),
      ).to.emit(factory, "ShareTokenCreated");

      const tokenAddress = await factory.getTokenByIdentifier(
        tokenParams.identifier,
      );
      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(await factory.isDeployedToken(tokenAddress)).to.equal(true);
      expect(await factory.deployedTokens(0)).to.equal(tokenAddress);
      expect(await factory.getDeployedTokenCount()).to.equal(1);
    });

    it("Should revert if identifier already exists", async function () {
      await createToken("TEST", ACN_A, company1);

      await expect(
        factory.createShareToken(
          "Another Company",
          "ANOTHER",
          `${ACN_A}:TEST`,
          ACN_A,
          500000n,
          company1.address,
        ),
      ).to.be.revertedWithCustomError(factory, "CompanyAlreadyExists");
    });

    it("Should revert if identifier is empty", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          "",
          tokenParams.acn,
          tokenParams.authorizedShares,
          company1.address,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidParameters");
    });

    it("Should revert if the ACN is empty", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          tokenParams.identifier,
          "",
          tokenParams.authorizedShares,
          company1.address,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidParameters");
    });

    it("Should revert if company owner is zero address", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          tokenParams.identifier,
          tokenParams.acn,
          tokenParams.authorizedShares,
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidParameters");
    });

    it("Should revert if authorized shares is zero", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          tokenParams.identifier,
          tokenParams.acn,
          0n,
          company1.address,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidParameters");
    });

    it("Should revert if the identifier is not the company's own", async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          `${ACN_B}:TEST`,
          ACN_A,
          tokenParams.authorizedShares,
          company1.address,
        ),
      )
        .to.be.revertedWithCustomError(factory, "IdentifierNotOfCompany")
        .withArgs(`${ACN_B}:TEST`, ACN_A);

      for (const identifier of [
        ACN_A,
        `${ACN_A}TEST`,
        `${ACN_A.slice(0, 5)}:TEST`,
      ]) {
        await expect(
          factory.createShareToken(
            tokenParams.name,
            tokenParams.symbol,
            identifier,
            ACN_A,
            tokenParams.authorizedShares,
            company1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "IdentifierNotOfCompany");
      }

      expect(await factory.registryOf(ACN_A)).to.equal(ethers.ZeroAddress);
    });

    it("Should revert if caller is not owner", async function () {
      await expect(
        factory
          .connect(company1)
          .createShareToken(
            tokenParams.name,
            tokenParams.symbol,
            tokenParams.identifier,
            tokenParams.acn,
            tokenParams.authorizedShares,
            company1.address,
          ),
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("One registry per company", function () {
    it("Should create the company's registry with its first token, owned by the token owner", async function () {
      const creation = await factory.createShareToken(
        "A Ordinary",
        "AORD",
        `${ACN_A}:AORD`,
        ACN_A,
        1000000n,
        company1.address,
      );

      const registry = await factory.registryOf(ACN_A);
      await expect(creation)
        .to.emit(factory, "WhitelistRegistryCreated")
        .withArgs(ACN_A, registry);
      const token = await ethers.getContractAt(
        "ShareToken",
        await factory.getTokenByIdentifier(`${ACN_A}:AORD`),
      );
      expect(registry).to.not.equal(ethers.ZeroAddress);
      expect(await token.whitelist()).to.equal(registry);
      expect(await (await registryOf(ACN_A)).owner()).to.equal(
        company1.address,
      );
    });

    it("Should bind two classes of one company to the same registry", async function () {
      const ordinary = await createToken("AORD", ACN_A, company1);
      const registry = await factory.registryOf(ACN_A);

      await expect(
        factory.createShareToken(
          "A Preference",
          "APREF",
          `${ACN_A}:APREF`,
          ACN_A,
          1000000n,
          company1.address,
        ),
      ).to.not.emit(factory, "WhitelistRegistryCreated");
      const preference = await ethers.getContractAt(
        "ShareToken",
        await factory.getTokenByIdentifier(`${ACN_A}:APREF`),
      );

      expect(await ordinary.whitelist()).to.equal(registry);
      expect(await preference.whitelist()).to.equal(registry);

      await (
        await registryOf(ACN_A)
      )
        .connect(company1)
        .setExpiry(investor.address, NO_EXPIRY);
      await ordinary.connect(company1).mint(investor.address, 10n);
      await preference.connect(company1).mint(investor.address, 20n);
      expect(await ordinary.balanceOf(investor.address)).to.equal(10n);
      expect(await preference.balanceOf(investor.address)).to.equal(20n);

      await (
        await registryOf(ACN_A)
      )
        .connect(company1)
        .setExpiry(investor.address, 0);
      await expect(
        preference.connect(company1).mint(investor.address, 1n),
      ).to.be.revertedWithCustomError(preference, "RecipientNotWhitelisted");
      await expect(
        ordinary.connect(investor).transfer(company1.address, 1n),
      ).to.be.revertedWithCustomError(ordinary, "SenderNotWhitelisted");
    });

    it("Should refuse a class whose owner does not own the company's registry", async function () {
      await createToken("AORD", ACN_A, company1);

      await expect(
        factory.createShareToken(
          "A Preference",
          "APREF",
          `${ACN_A}:APREF`,
          ACN_A,
          1000000n,
          company2.address,
        ),
      ).to.be.revertedWithCustomError(factory, "RegistryOwnerMismatch");
    });

    it("Should give each company its own registry", async function () {
      await createToken("AORD", ACN_A, company1);
      await createToken("BORD", ACN_B, company1);

      expect(await factory.registryOf(ACN_A)).to.not.equal(
        await factory.registryOf(ACN_B),
      );
    });
  });

  describe("Cross-company isolation", function () {
    let tokenA: ShareToken;
    let tokenB: ShareToken;
    let registryA: WhitelistRegistry;
    let registryB: WhitelistRegistry;

    beforeEach(async function () {
      tokenA = await createToken("AORD", ACN_A, company1);
      tokenB = await createToken("BORD", ACN_B, company1);
      registryA = await registryOf(ACN_A);
      registryB = await registryOf(ACN_B);
      await registryA.connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await registryA.connect(company1).setExpiry(other.address, NO_EXPIRY);
    });

    it("Should grant nothing on company B's token for an approval in company A's registry", async function () {
      expect(await registryB.isWhitelisted(investor.address)).to.equal(false);

      await tokenA.connect(company1).mint(investor.address, 10n);
      await expect(tokenB.connect(company1).mint(investor.address, 10n))
        .to.be.revertedWithCustomError(tokenB, "RecipientNotWhitelisted")
        .withArgs(investor.address);
    });

    it("Should refuse a company B transfer between wallets approved only in company A", async function () {
      await registryB.connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await tokenB.connect(company1).mint(investor.address, 10n);
      await registryB.connect(company1).setExpiry(investor.address, 0);

      await expect(
        tokenB.connect(investor).transfer(other.address, 1n),
      ).to.be.revertedWithCustomError(tokenB, "SenderNotWhitelisted");

      await registryB.connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await expect(
        tokenB.connect(investor).transfer(other.address, 1n),
      ).to.be.revertedWithCustomError(tokenB, "RecipientNotWhitelisted");
    });

    it("Should leave company A's approvals untouched by a removal in company B", async function () {
      await registryB.connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await registryB.connect(company1).setExpiry(investor.address, 0);

      await tokenA.connect(company1).mint(investor.address, 10n);
      await tokenA.connect(investor).transfer(other.address, 1n);
      expect(await tokenA.balanceOf(other.address)).to.equal(1n);
    });
  });

  describe("Owner-only registry writes", function () {
    it("Should refuse registry writes from the factory owner when it does not own the token", async function () {
      await createToken("AORD", ACN_A, company1);
      const registry = await registryOf(ACN_A);

      await expect(
        registry.connect(owner).setExpiry(investor.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await expect(
        registry.connect(investor).setExpiry(investor.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      expect(await registry.isWhitelisted(investor.address)).to.equal(false);
    });
  });
});
