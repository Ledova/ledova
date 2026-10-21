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
  await page.route('**/api/**', (route) => {
    const answer = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/verify/') return answer({ valid: true });
    if (path === '/api/user-accounts/') return answer({ uuid: 'account', role });
    if (path === '/api/user-preferences/')
      return answer({ userProfile: 'profile', userAccount: { uuid: 'account', role } });
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
      return answer({ ...EMPTY, count: 1, results: [{ uuid: 'company', name: LONG_NAME }] });
    }
    if (path === '/api/v1/tokens/register/' && role !== 'company')
      return answer({
        ...EMPTY,
        count: 1,
        results: [{ uuid: 'ordinary', companyUuid: 'company', companyName: LONG_NAME }],
      });
    if (path === '/api/v1/tokens/ordinary/holders/' && role !== 'company') return answer(ORDINARY);
    return answer(EMPTY);
  });
}

async function openTheSidebar(page: Page, role: Role) {
  await serveASignedInAccount(page, role);
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(role === 'company' ? '/home$' : '/company/dashboard$'));
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  if (role !== 'company') {
    const summary = page.getByRole('region', { name: 'Company ownership summary' });
    await expect(summary).toContainText('Issued shares135');
    await expect(summary).toContainText('Current shareholders2');
    const ownership = page.getByRole('table', { name: 'Largest shareholders in Ordinary shares' });
    await expect(ownership.getByRole('row', { name: 'Founder 100 74.07%' })).toBeVisible();
    await expect(ownership.getByRole('row', { name: 'Investor 35 25.93%' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Ordinary shares share ownership/ })).toBeVisible();
  }
  expect(await page.locator('html').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: 'Open navigation' }).click();
  const aside = page.locator('aside').filter({ visible: true });
  await expect(aside).toHaveCount(1);
  await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  await aside.locator('summary').filter({ hasText: 'More' }).click();
  await expect(aside.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Register', exact: true })).toHaveCount(role === 'company' ? 0 : 1);
  await expect(aside.getByText(LONG_NAME)).toHaveCount(0);
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
      });
    }
  }
});
