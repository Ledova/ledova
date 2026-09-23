import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  AtomicSwap,
  AUDY,
  ShareToken,
  ShareTokenFactory,
  WhitelistRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const NO_EXPIRY = 2n ** 64n - 1n;
const ACN_A = "123456789";
const ACN_B = "987654321";
const AUTHORIZED = 1000000n;
const SHARE_AMOUNT = 100n;
const PAYMENT_AMOUNT = 1000n;

const SWAP_ORDER_TYPES = {
  SwapOrder: [
    { name: "seller", type: "address" },
    { name: "buyer", type: "address" },
    { name: "shareToken", type: "address" },
    { name: "paymentToken", type: "address" },
    { name: "shareAmount", type: "uint256" },
    { name: "paymentAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

type SwapOrder = {
  seller: string;
  buyer: string;
  shareToken: string;
  paymentToken: string;
  shareAmount: bigint;
  paymentAmount: bigint;
  nonce: bigint;
  deadline: bigint;
};

describe("Approval bypasses", function () {
  let factory: ShareTokenFactory;
  let atomicSwap: AtomicSwap;
  let stablecoin: AUDY;
  let registryA: WhitelistRegistry;
  let registryB: WhitelistRegistry;
  let ordinaryA: ShareToken;
  let preferenceA: ShareToken;
  let ordinaryB: ShareToken;
  let operator: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let outsider: SignerWithAddress;
  let nonce = 0n;

  async function createToken(symbol: string, acn: string): Promise<ShareToken> {
    await factory.createShareToken(
      `${symbol} Shares`,
      symbol,
      `${acn}:${symbol}`,
      acn,
      AUTHORIZED,
      operator.address,
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

  async function order(
    shareToken: ShareToken | AUDY,
    seller: SignerWithAddress,
    buyer: SignerWithAddress,
    deadline?: bigint,
  ): Promise<SwapOrder> {
    nonce += 1n;
    return {
      seller: seller.address,
      buyer: buyer.address,
      shareToken: await shareToken.getAddress(),
      paymentToken: await stablecoin.getAddress(),
      shareAmount: SHARE_AMOUNT,
      paymentAmount: PAYMENT_AMOUNT,
      nonce,
      deadline: deadline ?? BigInt(await time.latest()) + 86400n,
    };
  }

  async function settle(
    swapOrder: SwapOrder,
    seller: SignerWithAddress,
    buyer: SignerWithAddress,
  ) {
    const domain = {
      name: "LedovaAtomicSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await atomicSwap.getAddress(),
    };
    return atomicSwap
      .connect(operator)
      .executeSwap(
        swapOrder.seller,
        swapOrder.buyer,
        swapOrder.shareToken,
        swapOrder.paymentToken,
        swapOrder.shareAmount,
        swapOrder.paymentAmount,
        swapOrder.nonce,
        swapOrder.deadline,
        await seller.signTypedData(domain, SWAP_ORDER_TYPES, swapOrder),
        await buyer.signTypedData(domain, SWAP_ORDER_TYPES, swapOrder),
      );
  }

  beforeEach(async function () {
    [operator, alice, bob, outsider] = await ethers.getSigners();
    nonce = 0n;

    const ShareTokenFactory =
      await ethers.getContractFactory("ShareTokenFactory");
    factory = await ShareTokenFactory.deploy(operator.address);
    await factory.waitForDeployment();

    ordinaryA = await createToken("AORD", ACN_A);
    preferenceA = await createToken("APREF", ACN_A);
    ordinaryB = await createToken("BORD", ACN_B);
    registryA = await registryOf(ACN_A);
    registryB = await registryOf(ACN_B);

    const AUDY = await ethers.getContractFactory("AUDY");
    stablecoin = await AUDY.deploy(operator.address);
    await stablecoin.waitForDeployment();
    await stablecoin.addMinter(operator.address);
    await stablecoin.mint(bob.address, 1000000n);

    const AtomicSwap = await ethers.getContractFactory("AtomicSwap");
    atomicSwap = await AtomicSwap.deploy(operator.address);
    await atomicSwap.waitForDeployment();
    await atomicSwap.setShareTokenApproval(await ordinaryA.getAddress(), true);
    await atomicSwap.setShareTokenApproval(await ordinaryB.getAddress(), true);
    await atomicSwap.setPaymentTokenApproval(
      await stablecoin.getAddress(),
      true,
    );

    for (const registry of [registryA, registryB]) {
      await registry.setExpiry(alice.address, NO_EXPIRY);
      await registry.setExpiry(bob.address, NO_EXPIRY);
    }
    await ordinaryA.mint(alice.address, 10000n);
    await ordinaryB.mint(alice.address, 10000n);

    for (const token of [ordinaryA, ordinaryB]) {
      await token
        .connect(alice)
        .approve(await atomicSwap.getAddress(), ethers.MaxUint256);
    }
    await stablecoin
      .connect(bob)
      .approve(await atomicSwap.getAddress(), ethers.MaxUint256);
  });

  describe("Burning out of an expired holder", function () {
    it("Should let an approved spender burnFrom an expired holder, because the burn sends to nobody and the holder granted the allowance", async function () {
      await ordinaryA.connect(alice).approve(bob.address, 500n);
      await registryA.setExpiry(alice.address, 0);

      await ordinaryA.connect(bob).burnFrom(alice.address, 500n);

      expect(await ordinaryA.balanceOf(alice.address)).to.equal(9500n);
      expect(await ordinaryA.totalSupply()).to.equal(9500n);
      expect(await ordinaryA.allowance(alice.address, bob.address)).to.equal(0);
    });

    it("Should refuse the same spender a transferFrom of the same shares", async function () {
      await ordinaryA.connect(alice).approve(bob.address, 500n);
      await registryA.setExpiry(alice.address, 0);

      await expect(
        ordinaryA.connect(bob).transferFrom(alice.address, bob.address, 500n),
      )
        .to.be.revertedWithCustomError(ordinaryA, "SenderNotWhitelisted")
        .withArgs(alice.address);
    });

    it("Should refuse a burnFrom without an allowance", async function () {
      await registryA.setExpiry(alice.address, 0);

      await expect(
        ordinaryA.connect(bob).burnFrom(alice.address, 500n),
      ).to.be.revertedWithCustomError(ordinaryA, "ERC20InsufficientAllowance");
    });
  });

  describe("Settling a swap with an expired or removed party", function () {
    it("Should refuse settlement when the seller's approval was removed", async function () {
      const swapOrder = await order(ordinaryA, alice, bob);
      await registryA.setExpiry(alice.address, 0);

      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(ordinaryA, "SenderNotWhitelisted")
        .withArgs(alice.address);
      expect(
        await atomicSwap.isNonceUsed(alice.address, swapOrder.nonce),
      ).to.equal(false);
    });

    it("Should refuse settlement when the buyer's approval was removed", async function () {
      const swapOrder = await order(ordinaryA, alice, bob);
      await registryA.setExpiry(bob.address, 0);

      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(ordinaryA, "RecipientNotWhitelisted")
        .withArgs(bob.address);
      expect(
        await atomicSwap.isNonceUsed(bob.address, swapOrder.nonce),
      ).to.equal(false);
    });

    it("Should refuse settlement when the buyer's approval expired", async function () {
      const expiry = BigInt(await time.latest()) + 60n;
      await registryA.setExpiry(bob.address, expiry);
      const swapOrder = await order(ordinaryA, alice, bob);
      await time.increaseTo(expiry + 10n);

      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(ordinaryA, "RecipientNotWhitelisted")
        .withArgs(bob.address);
      expect(await ordinaryA.balanceOf(bob.address)).to.equal(0);
      expect(await stablecoin.balanceOf(alice.address)).to.equal(0);
    });

    it("Should settle in the last second a party's approval names", async function () {
      const expiry = BigInt(await time.latest()) + 300n;
      await registryA.setExpiry(alice.address, expiry);
      const swapOrder = await order(ordinaryA, alice, bob, expiry + 3600n);
      await time.setNextBlockTimestamp(expiry - 1n);

      await expect(settle(swapOrder, alice, bob)).to.emit(
        atomicSwap,
        "SwapExecuted",
      );
      expect(await ordinaryA.balanceOf(bob.address)).to.equal(SHARE_AMOUNT);
    });

    it("Should refuse settlement in the second a party's expiry names", async function () {
      const expiry = BigInt(await time.latest()) + 300n;
      await registryA.setExpiry(alice.address, expiry);
      const swapOrder = await order(ordinaryA, alice, bob, expiry + 3600n);
      await time.setNextBlockTimestamp(expiry);

      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(ordinaryA, "SenderNotWhitelisted")
        .withArgs(alice.address);
      expect(await ordinaryA.balanceOf(bob.address)).to.equal(0);
    });

    it("Should refuse settlement of one company's token for parties approved only by another", async function () {
      const swapOrder = await order(ordinaryB, alice, bob);
      await registryB.setExpiry(alice.address, 0);
      await registryB.setExpiry(bob.address, 0);

      expect(await registryA.isWhitelisted(alice.address)).to.equal(true);
      expect(await registryA.isWhitelisted(bob.address)).to.equal(true);
      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(ordinaryB, "SenderNotWhitelisted")
        .withArgs(alice.address);
    });
  });

  describe("A company's registry and its classes", function () {
    it("Should refuse both of a company's classes once its one approval is removed", async function () {
      await preferenceA.mint(alice.address, 100n);
      await registryA.setExpiry(alice.address, 0);

      await expect(
        ordinaryA.connect(alice).transfer(bob.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "SenderNotWhitelisted");
      await expect(
        preferenceA.connect(alice).transfer(bob.address, 1n),
      ).to.be.revertedWithCustomError(preferenceA, "SenderNotWhitelisted");
      expect(await ordinaryB.balanceOf(alice.address)).to.equal(10000n);
      await ordinaryB.connect(alice).transfer(bob.address, 1n);
    });

    it("Should grant nothing on either of a company's classes for an approval held only elsewhere", async function () {
      await expect(
        ordinaryA.mint(outsider.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "RecipientNotWhitelisted");
      await registryB.setExpiry(outsider.address, NO_EXPIRY);

      await expect(
        ordinaryA.mint(outsider.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "RecipientNotWhitelisted");
      await expect(
        preferenceA.mint(outsider.address, 1n),
      ).to.be.revertedWithCustomError(preferenceA, "RecipientNotWhitelisted");
      await ordinaryB.mint(outsider.address, 1n);
      expect(await ordinaryB.balanceOf(outsider.address)).to.equal(1n);
    });
  });

  describe("A share token the factory did not create", function () {
    it("Should move a plain token the owner approved between unapproved parties, because no registry governs it", async function () {
      const AUDY = await ethers.getContractFactory("AUDY");
      const plain = await AUDY.deploy(operator.address);
      await plain.waitForDeployment();
      await plain.addMinter(operator.address);
      await plain.mint(outsider.address, 1000n);
      await plain
        .connect(outsider)
        .approve(await atomicSwap.getAddress(), ethers.MaxUint256);
      await atomicSwap.setShareTokenApproval(await plain.getAddress(), true);
      const swapOrder = await order(plain, outsider, bob);

      await expect(settle(swapOrder, outsider, bob)).to.emit(
        atomicSwap,
        "SwapExecuted",
      );
      expect(await plain.balanceOf(bob.address)).to.equal(SHARE_AMOUNT);
      expect(await factory.isDeployedToken(await plain.getAddress())).to.equal(
        false,
      );
      expect(await registryA.isWhitelisted(outsider.address)).to.equal(false);
    });

    it("Should still enforce its own registry for a share token deployed outside the factory", async function () {
      const ShareToken = await ethers.getContractFactory("ShareToken");
      const loose = await ShareToken.deploy(
        "Loose Shares",
        "LOOSE",
        await registryA.getAddress(),
        AUTHORIZED,
        operator.address,
      );
      await loose.waitForDeployment();
      await atomicSwap.setShareTokenApproval(await loose.getAddress(), true);
      await loose.mint(alice.address, 1000n);
      await loose
        .connect(alice)
        .approve(await atomicSwap.getAddress(), ethers.MaxUint256);
      const swapOrder = await order(loose as unknown as ShareToken, alice, bob);
      await registryA.setExpiry(alice.address, 0);

      expect(await factory.isDeployedToken(await loose.getAddress())).to.equal(
        false,
      );
      await expect(settle(swapOrder, alice, bob))
        .to.be.revertedWithCustomError(loose, "SenderNotWhitelisted")
        .withArgs(alice.address);
    });
  });

  describe("Pausing a token", function () {
    it("Should stop a swap settlement while the share token is paused", async function () {
      const swapOrder = await order(ordinaryA, alice, bob);
      await ordinaryA.pause();

      await expect(settle(swapOrder, alice, bob)).to.be.revertedWithCustomError(
        ordinaryA,
        "EnforcedPause",
      );

      await ordinaryA.unpause();
      await expect(settle(swapOrder, alice, bob)).to.emit(
        atomicSwap,
        "SwapExecuted",
      );
    });

    it("Should refuse a pause from anyone but the token owner", async function () {
      await expect(
        ordinaryA.connect(alice).pause(),
      ).to.be.revertedWithCustomError(ordinaryA, "OwnableUnauthorizedAccount");
      expect(await ordinaryA.paused()).to.equal(false);
    });
  });

  describe("Ownership renounced", function () {
    it("Should leave a registry unwritable for good, so approvals can only lapse", async function () {
      const expiry = BigInt(await time.latest()) + 300n;
      await registryA.setExpiry(alice.address, expiry);

      await registryA.renounceOwnership();

      expect(await registryA.owner()).to.equal(ethers.ZeroAddress);
      await expect(
        registryA.setExpiry(alice.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(registryA, "OwnableUnauthorizedAccount");
      await expect(
        registryA.setExpiry(outsider.address, NO_EXPIRY),
      ).to.be.revertedWithCustomError(registryA, "OwnableUnauthorizedAccount");
      await time.increaseTo(expiry);
      await expect(
        ordinaryA.connect(alice).transfer(bob.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "SenderNotWhitelisted");
    });

    it("Should leave a token unmintable and unpausable for good, while its registry still governs transfers", async function () {
      await ordinaryA.renounceOwnership();

      expect(await ordinaryA.owner()).to.equal(ethers.ZeroAddress);
      await expect(
        ordinaryA.mint(alice.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "OwnableUnauthorizedAccount");
      await expect(ordinaryA.pause()).to.be.revertedWithCustomError(
        ordinaryA,
        "OwnableUnauthorizedAccount",
      );
      await ordinaryA.connect(alice).transfer(bob.address, 1n);
      await registryA.setExpiry(bob.address, 0);
      await expect(
        ordinaryA.connect(alice).transfer(bob.address, 1n),
      ).to.be.revertedWithCustomError(ordinaryA, "RecipientNotWhitelisted");
    });
  });
});
