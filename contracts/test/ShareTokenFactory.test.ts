import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { ShareToken, ShareTokenFactory, WhitelistRegistry } from '../typechain-types';

const NO_EXPIRY = 2n ** 64n - 1n;
const ACN_A = '123456789';
const ACN_B = '987654321';

describe('ShareTokenFactory', function () {
  let factory: ShareTokenFactory;
  let owner: SignerWithAddress;
  let company1: SignerWithAddress;
  let company2: SignerWithAddress;
  let investor: SignerWithAddress;
  let other: SignerWithAddress;

  async function createToken(symbol: string, acn: string, tokenOwner: SignerWithAddress): Promise<ShareToken> {
    await factory.createShareToken(`${symbol} Shares`, symbol, `${acn}:${symbol}`, acn, 1000000n, tokenOwner.address);
    return ethers.getContractAt('ShareToken', await factory.getTokenByIdentifier(`${acn}:${symbol}`));
  }

  async function registryOf(acn: string): Promise<WhitelistRegistry> {
    return ethers.getContractAt('WhitelistRegistry', await factory.registryOf(acn));
  }

  beforeEach(async function () {
    [owner, company1, company2, investor, other] = await ethers.getSigners();

    const ShareTokenFactory = await ethers.getContractFactory('ShareTokenFactory');
    factory = await ShareTokenFactory.deploy(owner.address);
    await factory.waitForDeployment();
  });

  describe('Creating ShareTokens', function () {
    const tokenParams = {
      name: 'Test Company Shares',
      symbol: 'TEST',
      identifier: `${ACN_A}:TEST`,
      acn: ACN_A,
      authorizedShares: 1000000n,
    };

    it('Should create a new ShareToken', async function () {
      await expect(
        factory.createShareToken(
          tokenParams.name,
          tokenParams.symbol,
          tokenParams.identifier,
          tokenParams.acn,
          tokenParams.authorizedShares,
          company1.address,
        ),
      ).to.emit(factory, 'ShareTokenCreated');

      const tokenAddress = await factory.getTokenByIdentifier(tokenParams.identifier);
      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(await factory.isDeployedToken(tokenAddress)).to.equal(true);
      expect(await factory.deployedTokens(0)).to.equal(tokenAddress);
      expect(await factory.getDeployedTokenCount()).to.equal(1);
    });

    it('Should revert if identifier already exists', async function () {
      await createToken('TEST', ACN_A, company1);

      await expect(
        factory.createShareToken('Another Company', 'ANOTHER', `${ACN_A}:TEST`, ACN_A, 500000n, company1.address),
      ).to.be.revertedWithCustomError(factory, 'CompanyAlreadyExists');
    });

    it('Should revert if caller is not owner', async function () {
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
      ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
    });
  });

  describe('One registry per company', function () {
    it('Should bind two classes of one company to the same registry', async function () {
      const ordinary = await createToken('AORD', ACN_A, company1);
      const registry = await factory.registryOf(ACN_A);

      await expect(
        factory.createShareToken('A Preference', 'APREF', `${ACN_A}:APREF`, ACN_A, 1000000n, company1.address),
      ).to.not.emit(factory, 'WhitelistRegistryCreated');
      const preference = await ethers.getContractAt('ShareToken', await factory.getTokenByIdentifier(`${ACN_A}:APREF`));

      expect(await ordinary.whitelist()).to.equal(registry);
      expect(await preference.whitelist()).to.equal(registry);

      await (await registryOf(ACN_A)).connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await ordinary.connect(company1).mint(investor.address, 10n);
      await preference.connect(company1).mint(investor.address, 20n);
      expect(await ordinary.balanceOf(investor.address)).to.equal(10n);
      expect(await preference.balanceOf(investor.address)).to.equal(20n);

      await (await registryOf(ACN_A)).connect(company1).setExpiry(investor.address, 0);
      await expect(preference.connect(company1).mint(investor.address, 1n)).to.be.revertedWithCustomError(
        preference,
        'RecipientNotWhitelisted',
      );
      await expect(ordinary.connect(investor).transfer(company1.address, 1n)).to.be.revertedWithCustomError(
        ordinary,
        'SenderNotWhitelisted',
      );
    });
  });

  describe('Cross-company isolation', function () {
    let tokenA: ShareToken;
    let tokenB: ShareToken;
    let registryA: WhitelistRegistry;
    let registryB: WhitelistRegistry;

    beforeEach(async function () {
      tokenA = await createToken('AORD', ACN_A, company1);
      tokenB = await createToken('BORD', ACN_B, company1);
      registryA = await registryOf(ACN_A);
      registryB = await registryOf(ACN_B);
      await registryA.connect(company1).setExpiry(investor.address, NO_EXPIRY);
      await registryA.connect(company1).setExpiry(other.address, NO_EXPIRY);
    });

    it("Should grant nothing on company B's token for an approval in company A's registry", async function () {
      expect(await registryB.isWhitelisted(investor.address)).to.equal(false);

      await tokenA.connect(company1).mint(investor.address, 10n);
      await expect(tokenB.connect(company1).mint(investor.address, 10n))
        .to.be.revertedWithCustomError(tokenB, 'RecipientNotWhitelisted')
        .withArgs(investor.address);
    });
  });
});
