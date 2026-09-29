import { test, expect, type Page } from '@playwright/test';

const ACCOUNT_UUID = '0f7d5a52-4a4a-4d3c-9d4c-3e9f8b8e2a11';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const BASE_SEPOLIA_CHAIN_ID = 84532;
const UNMOCKED_API_NOISE = ['Failed to load resource', 'API request failed: status=404'];

function hardwareWallet(uuid: string, name: string, verificationStatus: 'PENDING' | 'VERIFIED') {
  return {
    uuid,
    name,
    verificationStatus,
    address: '0x1111111111111111111111111111111111111111',
    addressIndex: 0,
    chain: 'base',
    derivationPath: "m/44'/60'/0'/0/0",
    masterFingerprint: 'a1b2c3d4',
    signingPreference: 'hardware',
    walletType: 'hardware',
    nativeBalance: '0.5',
    nativeMarketValue: '1000',
    marketValue: '1000',
    lastSyncedAt: null,
    userAccount: ACCOUNT_UUID,
    verificationChallenge: null,
    verificationSignature: null,
    verifiedAt: verificationStatus === 'VERIFIED' ? '2026-09-01T00:00:00Z' : null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

const UNVERIFIED_WALLET = hardwareWallet(
  '5b0c1f0e-2d6a-4f57-9a61-3f1d8c2b7e10',
  'Keystone awaiting verification',
  'PENDING',
);
const VERIFIED_WALLET = hardwareWallet('7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', 'Keystone ready to send', 'VERIFIED');

const USER_ACCOUNT = {
  uuid: ACCOUNT_UUID,
  accountNumber: 'LDV-0001',
  accountType: 'individual',
  activationDate: '2026-09-01',
  role: 'investor',
};

const USER_PROFILE = {
  uuid: '8c3e7f0a-1b2d-4e5f-8a9b-0c1d2e3f4a5b',
  email: 'investor@example.test',
  fullName: 'Keystone Investor',
  isActive: true,
  isIdVerified: true,
  isSignupCompleted: true,
  isStaff: false,
  termsAndConditions: true,
  dateJoined: '2026-09-01T00:00:00Z',
  lastLogin: null,
  citizenshipCountry: 'AU',
  citizenshipCountryName: 'Australia',
  residenceCountryName: 'Australia',
  kycaidApplicantId: null,
  kycProvider: 'sumsub',
  rejectionLabels: null,
  reviewResult: null,
  sumsubApplicantId: null,
  sumsubVerificationStatus: null,
  verificationStatus: 'completed',
  verifiedAt: '2026-09-01T00:00:00Z',
};

const OPERATOR = {
  name: 'Ledova',
  legalName: 'Ledova Smoke Test Operator',
  abn: '00000000000',
  contactEmail: 'operator@example.test',
  deploymentMode: 'registry',
  investorKycRequired: false,
  issuerKycRequired: false,
  issuedStablecoin: null,
  paymentInstructions: null,
  supportedSettlementAssets: [],
  website: 'https://example.test',
};

const USER_PREFERENCES = {
  uuid: '9d4f8a1b-2c3e-4f5a-9b6c-7d8e9f0a1b2c',
  userProfile: USER_PROFILE.uuid,
  userAccount: USER_ACCOUNT,
  selectedPortfolio: null,
  theme: 'light',
  transactionAlerts: true,
};

const PREPARED_TRANSFER = {
  fromAddress: VERIFIED_WALLET.address,
  toAddress: RECIPIENT,
  amountEth: '0.001',
  gasCostEth: '0.000021',
  gasLimit: 21000,
  gasPriceGwei: '1',
  gasPriceWei: '1000000000',
  totalCostEth: '0.001021',
  transaction: {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    to: RECIPIENT,
    value: 1_000_000_000_000_000,
    gas: 21000,
    gasPrice: 1_000_000_000,
    nonce: 7,
    data: '0x',
  },
};

function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function serveASignedInInvestor(page: Page) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

    switch (`${method} ${url.pathname}`) {
      case 'GET /api/auth/verify/':
        return json({ valid: true });
      case 'GET /api/user-accounts/':
        return json(USER_ACCOUNT);
      case 'GET /api/user-profiles/':
        return json(paginated([USER_PROFILE]));
      case 'GET /api/user-preferences/':
        return json(USER_PREFERENCES);
      case 'GET /api/operator/':
        return json(OPERATOR);
      case 'GET /api/feature-flags/':
        return json(paginated([]));
      case 'GET /api/notifications/unread-count/':
        return json({ unreadCount: 0 });
      case 'GET /api/assets/exchange-rates/':
        return json({ baseCurrency: 'USD', targetCurrency: 'AUD', rate: '1.5' });
      case 'GET /api/wallets/':
        return json(
          paginated(
            url.searchParams.get('verification_status') === 'VERIFIED'
              ? [VERIFIED_WALLET]
              : [UNVERIFIED_WALLET, VERIFIED_WALLET],
          ),
        );
      case `GET /api/wallets/${VERIFIED_WALLET.uuid}/holdings/`:
        return json([]);
      case `POST /api/wallets/${UNVERIFIED_WALLET.uuid}/request-verification/`:
        return json({
          challenge: 'Ledova wallet verification: smoke-test challenge 3f1d8c2b',
          message: 'Sign this challenge with your hardware wallet.',
          walletAddress: UNVERIFIED_WALLET.address,
        });
      case `POST /api/wallets/${VERIFIED_WALLET.uuid}/prepare-transfer/`:
        return json(PREPARED_TRANSFER);
      default:
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Not found.' }),
        });
    }
  });
}

function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return () => errors.filter((text) => !UNMOCKED_API_NOISE.some((noise) => text.includes(noise)));
}

test.describe('the built dashboard encodes Keystone QR codes', () => {
  test.beforeEach(async ({ page }) => {
    await serveASignedInInvestor(page);
  });

  test('a wallet verification challenge renders as a Keystone sign request', async ({ page }) => {
    const errors = recordErrors(page);
    await page.goto('/wallets');
    await page
      .getByRole('group', { name: 'Keystone awaiting verification' })
      .getByRole('button', { name: 'Verify', exact: true })
      .click();

    const verify = page.getByRole('dialog', { name: 'Verify Wallet' });
    await verify.getByRole('button', { name: 'Continue' }).click();

    await expect(verify.getByRole('heading', { name: 'Scan Challenge' })).toBeVisible();
    await expect(verify.locator('svg[role="img"]')).toBeVisible();
    await expect(verify.getByText('Failed to generate QR code')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/keystone-verification-qr.png' });
    expect(errors()).toEqual([]);
  });

  test('a transfer renders as an animated Keystone sign request', async ({ page }) => {
    const errors = recordErrors(page);
    await page.goto('/wallets');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const send = page.getByRole('dialog', { name: 'Send' });
    await send.getByPlaceholder('0x...').fill(RECIPIENT);
    await send.getByPlaceholder('0.00').fill('0.001');
    await send.getByRole('button', { name: 'Continue' }).click();

    const signing = page.getByRole('dialog', { name: 'Sign Transfer' });
    await signing.getByRole('button', { name: 'Continue' }).click();

    await expect(signing.getByText('Scan this QR code with your hardware wallet to sign the transfer.')).toBeVisible();
    await expect(signing.locator('canvas')).toBeVisible();
    await expect(signing.getByText('Failed to encode transaction')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/keystone-transfer-qr.png' });
    expect(errors()).toEqual([]);
  });
});
