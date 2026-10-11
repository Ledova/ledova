import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { WhitelistRegistry } from '../typechain-types';

const NO_EXPIRY = 2n ** 64n - 1n;

describe('WhitelistRegistry', function () {
  let whitelist: WhitelistRegistry;
  let owner: SignerWithAddress;
  let investor: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  beforeEach(async function () {
    [owner, investor, nonOwner] = await ethers.getSigners();

    const WhitelistRegistry = await ethers.getContractFactory('WhitelistRegistry');
    whitelist = await WhitelistRegistry.deploy(owner.address);
    await whitelist.waitForDeployment();
  });

  describe('Setting an expiry', function () {
    it('Should stop listing an address once its expiry has passed', async function () {
      const expiry = BigInt(await time.latest()) + 60n;
      await whitelist.setExpiry(investor.address, expiry);

      await time.increaseTo(expiry + 1n);

      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });
  });

  describe('Owner-only writes', function () {
    it('Should refuse a write from anyone but the owner', async function () {
      await expect(whitelist.connect(nonOwner).setExpiry(investor.address, NO_EXPIRY)).to.be.revertedWithCustomError(
        whitelist,
        'OwnableUnauthorizedAccount',
      );
      expect(await whitelist.isWhitelisted(investor.address)).to.equal(false);
    });
  });
});
