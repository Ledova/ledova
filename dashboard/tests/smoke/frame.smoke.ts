import { test, expect, type Page } from '@playwright/test';

type Role = 'investor' | 'company' | 'both';

const EMPTY = { results: [], count: 0, next: null, previous: null };
const LONG_NAME = 'HARBOUR ROBOTICS AND AUTONOMOUS MARINE SYSTEMS HOLDINGS PTY LTD';
const ORDINARY = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'draft', totalSupply: '1000' },
  initialized: true,
  issuedSupply: '135',
  totalHolders: 2,
  waitingEffects: 0,
  formerMembers: [],
  formerMembersAsAt: null,
  formerMembersBlock: null,
  formerMembersStale: false,
  holders: [
    { member: 'founder', name: 'Founder', balance: '100', percentage: 74.07 },
    { member: 'investor', name: 'Investor', balance: '35', percentage: 25.93 },
  ].map((holder) => ({
    ...holder,
    holderType: 'member',
    enteredOn: '2026-10-11',
    identitySource: 'company_recorded',
    shareClass: 'ORD',
    source: 'register',
    wallets: [],
  })),
};

async function serveASignedInAccount(page: Page, role: Role) {
  const reads = { memberLists: 0, appointments: 0, companies: 0 };
  let transactionAlerts = false;
  const company = {
    uuid: 'company',
    name: LONG_NAME,
    status: 'draft',
    statusDisplay: 'Draft',
    companyTypeDisplay: 'Proprietary Limited (Pty Ltd)',
    acn: '929000000',
    isOwner: role !== 'investor',
    administrativeAccess: { draftSetup: role !== 'investor', capabilities: role === 'both' ? ['admin'] : [] },
    documents: [],
  };
  const memberRecord = {
    uuid: 'own-record',
    member: 'investor',
    company,
    name: 'Ada Lovelace',
    residentialAddress: 'Demo address',
    identitySource: 'company_recorded',
    classes: [
      {
        uuid: 'ordinary',
        name: 'Ordinary shares',
        symbol: 'ORD',
        shares: '35',
        enteredOn: '2026-10-11',
        ceasedOn: null,
        amountPaid: '350.00',
      },
    ],
    awards: [],
  };
  await page.route('**/api/**', (route) => {
    const answer = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/tokens/member-records/') reads.memberLists += 1;
    if (path === '/api/v1/company-authority/appointments/') reads.appointments += 1;
    if (path === '/api/v1/companies/') reads.companies += 1;
    if (path === '/api/auth/verify/') return answer({ valid: true });
    if (path === '/api/user-accounts/') return answer({ uuid: 'account', role });
    if (path === '/api/user-preferences/') {
      if (route.request().method() === 'POST') transactionAlerts = route.request().postDataJSON().transactionAlerts;
      return answer({ userProfile: 'profile', userAccount: { uuid: 'account', role }, transactionAlerts });
    }
    if (path === '/api/user-profiles/') {
      return answer({
        ...EMPTY,
        count: 1,
        results: [{ uuid: 'profile', isSignupCompleted: true, fullName: 'Ada Lovelace', email: 'ada@example.test' }],
      });
    }
    if (path === '/api/feature-flags/') {
      return answer({ ...EMPTY, count: 1, results: [{ name: 'trading_enabled', enabled: true }] });
    }
    if (path === '/api/v1/companies/') {
      return answer({ ...EMPTY, count: 1, results: [company] });
    }
    if (path === '/api/v1/companies/company/') return answer(company);
    if (path === '/api/v1/tokens/member-records/own-record/') return answer(memberRecord);
    if (path === '/api/v1/tokens/member-records/')
      return answer({
        ...EMPTY,
        count: 1,
        results: [memberRecord],
      });
    if (path === '/api/v1/company-authority/appointments/' && role === 'both')
      return answer({
        ...EMPTY,
        count: 1,
        results: [
          {
            uuid: 'appointment',
            company: 'company',
            companyName: LONG_NAME,
            companyStatus: 'draft',
            companyStatusDisplay: 'Draft',
            capabilities: ['admin'],
            delegatableCapabilities: ['admin'],
            status: 'active',
            isEffective: true,
            revokedAt: null,
            expiresAt: null,
            source: 'initial',
          },
        ],
      });
    if (path === '/api/v1/tokens/register/' && role !== 'company')
      return answer({
        ...EMPTY,
        count: 1,
        results: [{ uuid: 'ordinary', companyUuid: 'company', companyName: LONG_NAME }],
      });
    if (path === '/api/v1/tokens/ordinary/holders/' && role !== 'company') return answer(ORDINARY);
    if (path === '/api/v1/tokens/ownership/' && role !== 'company')
      return answer({
        company: company.uuid,
        companyName: LONG_NAME,
        asAt: '2026-10-26T00:00:00Z',
        complete: true,
        issuedSupply: ORDINARY.issuedSupply,
        totalHolders: ORDINARY.totalHolders,
        classes: [
          {
            uuid: ORDINARY.token.uuid,
            name: ORDINARY.token.name,
            symbol: ORDINARY.token.symbol,
            tokenType: 'ordinary',
            initialized: true,
            issuedSupply: ORDINARY.issuedSupply,
            totalHolders: ORDINARY.totalHolders,
            sequence: 1,
            recordedAt: '2026-10-26T00:00:00Z',
          },
        ],
      });
    if (path === '/api/v1/tokens/ordinary/ownership-holders/' && role !== 'company')
      return answer({
        count: ORDINARY.totalHolders,
        next: null,
        previous: null,
        token: ORDINARY.token.uuid,
        sequence: 1,
        issuedSupply: ORDINARY.issuedSupply,
        asAt: '2026-10-26T00:00:00Z',
        results: ORDINARY.holders.map(({ member, name, balance, percentage }) => ({
          member,
          name,
          balance,
          percentage: percentage.toFixed(2),
        })),
      });
    return answer(EMPTY);
  });
  return reads;
}

async function openTheSidebar(page: Page, role: Role) {
  const reads = await serveASignedInAccount(page, role);
  await page.goto('/');
  await expect(page).toHaveURL(/\/company\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  if (role !== 'company') {
    const summary = page.getByRole('region', { name: 'Company ownership summary' });
    await expect(summary).toContainText('Issued shares135');
    await expect(summary).toContainText('Current shareholders2');
    await page.getByRole('combobox', { name: 'Explore a class' }).selectOption('ordinary');
    const ownership = page.getByRole('table', { name: 'Ordinary shares shareholders' });
    await expect(ownership.getByRole('row', { name: 'Founder 100 74.07%' })).toBeVisible();
    await expect(ownership.getByRole('row', { name: 'Investor 35 25.93%' })).toBeVisible();
    await page.getByRole('button', { name: 'All classes', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Explore a class' })).toBeFocused();
  }
  expect(await page.locator('html').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const phone = page.viewportSize()!.width < 1024;
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  const aside = page.locator('aside').filter({ visible: true });
  await expect(aside).toHaveCount(1);
  await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  await expect(aside.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).toHaveCount(role === 'company' ? 0 : 1);
  await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveValue('company');
  await expect(aside.getByRole('link', { name: 'Your shares', exact: true })).toHaveCount(0);
  await expect(aside.getByText(LONG_NAME)).toHaveCount(0);
  if (role !== 'company') {
    const toggle = aside.getByRole('button', { name: 'Expand Ledger navigation' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(aside.getByRole('button', { name: 'Collapse Ledger navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const [name, hash] of [
      ['Issue shares', 'issue'],
      ['Transfer shares', 'transfer'],
      ['Corrections', 'corrections'],
    ]) {
      await expect(aside.getByRole('link', { name, exact: true })).toHaveAttribute('href', `/company/ledger#${hash}`);
    }
    await expect(aside.getByRole('link', { name: 'History', exact: true })).toHaveCount(0);
    await aside.getByRole('link', { name: 'Corrections', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Corrections', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Class details', exact: true })).toHaveCount(0);
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(aside.getByRole('link', { name: 'Corrections', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).not.toHaveAttribute('aria-current');
    await aside.getByRole('link', { name: 'Ledger', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ledger', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(aside.getByRole('link', { name: 'ESS', exact: true })).toHaveCount(0);
    await aside.getByRole('button', { name: 'Expand Shareholders navigation' }).click();
    const shareholders = aside.getByRole('link', { name: 'Shareholders', exact: true }).locator('../..');
    const awards = shareholders.getByRole('link', { name: 'ESS', exact: true, includeHidden: true });
    await expect(awards).toHaveAttribute('href', '/company/ledger#awards');
    await expect(awards).toHaveAttribute('title', 'Employee share scheme');
    await expect(aside.getByRole('link', { name: 'ESS', exact: true })).toHaveCount(1);
    await awards.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Employee share scheme', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(awards).toHaveAttribute('aria-current', 'page');
    await expect(shareholders.getByRole('link', { name: 'Shareholders', exact: true })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).not.toHaveAttribute('aria-current');
    await expect(aside.getByRole('button', { name: 'Collapse Shareholders navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const documents = aside.getByRole('link', { name: 'Documents', exact: true }).locator('../..');
    const documentsLink = documents.getByRole('link', { name: 'Documents', exact: true });
    await expect(documentsLink).toHaveAttribute('href', '/company/ledger#certificates');
    await expect(documents.getByRole('button', { name: 'Expand Documents navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await documentsLink.click();
    await expect(page).toHaveURL(/\/company\/ledger#certificates$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Certificates', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    const certificates = documents.getByRole('link', { name: 'Certificates', exact: true });
    const exports = documents.getByRole('link', { name: 'Ledger exports', exact: true });
    const pack = documents.getByRole('link', { name: 'Company pack', exact: true });
    await expect(certificates).toHaveAttribute('href', '/company/ledger#certificates');
    await expect(exports).toHaveAttribute('href', '/company/ledger#ledger-exports');
    await expect(pack).toHaveAttribute('href', '/company/ledger#company-pack');
    await expect(certificates).toHaveAttribute('aria-current', 'page');
    await expect(documentsLink).not.toHaveAttribute('aria-current');
    await expect(awards).not.toHaveAttribute('aria-current');
    await documents.getByRole('button', { name: 'Collapse Documents navigation' }).click();
    await expect(documents.getByRole('button', { name: 'Expand Documents navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(certificates).not.toBeVisible();
    await expect(page).toHaveURL(/\/company\/ledger#certificates$/);
    await documents.getByRole('button', { name: 'Expand Documents navigation' }).click();
    await expect(documents.getByRole('button', { name: 'Collapse Documents navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await exports.click();
    await expect(page).toHaveURL(/\/company\/ledger#ledger-exports$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ledger exports', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(exports).toHaveAttribute('aria-current', 'page');
    await expect(certificates).not.toHaveAttribute('aria-current');
    await pack.click();
    await expect(page).toHaveURL(/\/company\/ledger#company-pack$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Company pack', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(pack).toHaveAttribute('aria-current', 'page');
    await expect(exports).not.toHaveAttribute('aria-current');
    await expect(documentsLink).not.toHaveAttribute('aria-current');
  }
  const settings = aside.getByRole('link', { name: 'Settings', exact: true }).locator('../..');
  const settingsLink = settings.getByRole('link', { name: 'Settings', exact: true });
  await expect(settingsLink).toHaveAttribute('href', '/settings#profile');
  await settings.getByRole('button', { name: 'Expand Settings navigation' }).click();
  await expect(settings.getByRole('button', { name: 'Collapse Settings navigation' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const profile = settings.getByRole('link', { name: 'Profile', exact: true });
  await expect(profile).toHaveAttribute('href', '/settings#profile');
  await expect(settings.getByRole('link', { name: 'Team', exact: true })).toHaveAttribute('href', '/company/team');
  await expect(settings.getByRole('link', { name: 'Company-recorded details', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Company', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Documents', exact: true })).toHaveCount(role === 'investor' ? 0 : 1);
  await expect(settings.getByRole('link', { name: 'Activation', exact: true })).toHaveCount(role === 'both' ? 1 : 0);
  await settingsLink.click();
  await expect(page).toHaveURL(/\/settings#profile$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
  for (const name of ['Personal information', 'Account'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Company details', exact: true })).toHaveCount(
    role === 'investor' ? 0 : 1,
  );
  await expect(page.getByRole('link', { name: 'Back to Settings', exact: true })).toHaveCount(0);
  for (const name of ['Account status', 'Security', 'Preferences', 'Data and privacy', 'Supporting payslips'])
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review identity check', exact: true })).toHaveCount(1);
  const manageAccount = page.getByRole('button', { name: 'Manage account', exact: true });
  await manageAccount.click();
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
  await manageAccount.click();
  if (role === 'both') {
    await page.getByRole('button', { name: 'Edit company', exact: true }).click();
    await page.getByRole('textbox', { name: 'Trading name', exact: true }).fill('Unsent company draft');
    const alerts = page.getByRole('switch', { name: 'Transaction alerts', exact: true });
    await alerts.click();
    await expect(alerts).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('form', { name: 'Edit company', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Trading name', exact: true })).toHaveValue('Unsent company draft');
    if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
    await aside.getByRole('combobox', { name: 'Workspace' }).selectOption('my-shares');
    const leave = page.getByRole('dialog', { name: 'Leave this workspace?', exact: true });
    await expect(leave.getByRole('heading', { name: 'Leave this workspace?', exact: true })).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(leave.getByRole('heading', { name: 'Leave this workspace?', exact: true })).not.toBeVisible();
    if (phone) {
      const closeNavigation = page.getByRole('button', { name: 'Close navigation', exact: true });
      await closeNavigation.click();
      await expect(closeNavigation).not.toBeVisible();
    }
    await expect(page.getByRole('textbox', { name: 'Trading name', exact: true })).toHaveValue('Unsent company draft');
    if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
    await aside.getByRole('combobox', { name: 'Workspace' }).selectOption('my-shares');
    await leave.getByRole('button', { name: 'Leave workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveValue('my-shares');
    await aside.getByRole('combobox', { name: 'Workspace' }).selectOption('company');
    await expect(page).toHaveURL(/\/company\/dashboard$/);
    await page.goto('/settings#profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
  }
  if (phone) {
    await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await expect(profile).toHaveAttribute('aria-current', 'page');
  if (role !== 'investor') {
    const sourceDocuments = settings.getByRole('link', { name: 'Documents', exact: true });
    await sourceDocuments.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Documents', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(sourceDocuments).toHaveAttribute('aria-current', 'page');
    await expect(profile).not.toHaveAttribute('aria-current');
    await profile.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
    if (phone) {
      await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
  }
  await expect(profile).toHaveAttribute('aria-current', 'page');
  for (const alias of ['/company', '/user-profile', '/settings#account']) {
    await page.goto(alias);
    await expect(page).toHaveURL(/\/settings#profile$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  }
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(profile).toHaveAttribute('aria-current', 'page');
  await settings.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Team', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept a company invitation', exact: true })).toBeVisible();
  if (phone) {
    await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await expect(settings.getByRole('link', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page');
  if (phone) {
    const cachedReads = { ...reads };
    expect(cachedReads.memberLists).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Navigation' })).not.toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await settings.getByRole('button', { name: 'Collapse Settings navigation' }).click();
    await expect(settings.getByRole('button', { name: 'Expand Settings navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await settings.getByRole('button', { name: 'Expand Settings navigation' }).click();
    await expect(settings.getByRole('link', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(reads).toEqual(cachedReads);
  }
  await aside.getByRole('combobox', { name: 'Workspace' }).selectOption('my-shares');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveValue('my-shares');
  await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).toHaveCount(0);
  await expect(aside.getByRole('link', { name: 'Shareholders', exact: true })).toHaveCount(0);
  await aside.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Company details', exact: true })).toHaveCount(0);
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(settings.getByRole('link', { name: 'Company-recorded details', exact: true })).toHaveCount(1);
  for (const label of ['Team', 'Documents', 'Activation'])
    await expect(settings.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/);
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  await aside.getByRole('combobox', { name: 'Workspace' }).selectOption('company');
  await expect(page).toHaveURL(/\/company\/dashboard$/);
  await page.goto('/home#documents');
  await expect(page.getByRole('heading', { level: 1, name: 'Documents', exact: true })).toBeVisible();
  if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveValue('my-shares');
  await aside.locator('summary').filter({ hasText: 'More' }).click();
  if (role !== 'company') await expect(aside.getByText('Invest', { exact: true })).toBeVisible();
  return aside;
}

function bottomOf(box: { y: number; height: number } | null) {
  return box!.y + box!.height;
}

async function checkTheCutEdge(aside: ReturnType<Page['locator']>) {
  const list = aside.locator('nav').locator('..');
  const foot = aside.locator(':scope > :last-child');
  const help = aside.getByRole('link', { name: 'Help & Support' });

  expect(await list.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
  expect(await list.evaluate((node) => node.nextElementSibling === node.parentElement?.lastElementChild)).toBe(true);
  await expect(foot).toContainText('Sign out');
  await expect(foot).toHaveCSS('border-top-style', 'solid');
  await expect(foot).toHaveCSS('border-top-width', '1px');
  expect(Math.abs((await foot.boundingBox())!.y - bottomOf(await list.boundingBox()))).toBeLessThan(0.5);

  expect(await list.evaluate((node) => node.lastElementChild?.textContent)).toBe('Help & Support');
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(bottomOf(await help.boundingBox())).toBeLessThanOrEqual(bottomOf(await list.boundingBox()));
}

test.describe('the signed-in sidebar when its list is longer than the screen', () => {
  const layouts = [
    {
      name: 'the phone drawer',
      viewport: { width: 320, height: 600 },
      roles: ['investor', 'company', 'both'] as Role[],
    },
    { name: 'the desktop sidebar', viewport: { width: 1440, height: 600 }, roles: ['both'] as Role[] },
  ];

  for (const layout of layouts) {
    for (const role of layout.roles) {
      test(`cuts the ${role} list at the foot's rule in ${layout.name}, with Help & Support at the list's end`, async ({
        page,
      }) => {
        await page.setViewportSize(layout.viewport);

        await checkTheCutEdge(await openTheSidebar(page, role));
        if (role === 'investor') {
          for (const endpoint of [
            '/api/v1/tokens/register/',
            '/api/v1/companies/',
            '/api/v1/company-authority/appointments/',
          ])
            await page.route(`**${endpoint}*`, (route) =>
              route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }),
            );
          await page.goto('/settings#profile');
          await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          const workspace = page
            .locator('aside')
            .filter({ visible: true })
            .getByRole('combobox', { name: 'Workspace' });
          await expect(workspace).toHaveValue('my-shares');
          await expect(workspace.locator('option[value="company"]')).toHaveCount(0);
          await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
          await page.getByRole('button', { name: 'Manage account', exact: true }).click();
          const invitation = page.getByRole('link', { name: 'Accept a company invitation', exact: true });
          await expect(invitation).toHaveAttribute('href', '/company/team');
          await invitation.click();
          await page.getByRole('button', { name: 'Accept a company invitation', exact: true }).click();
          await expect(page.getByRole('textbox', { name: 'Invitation code', exact: true })).toBeVisible();
        }
      });
    }
  }
});
