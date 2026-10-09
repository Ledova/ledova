import { test, expect, type Page } from '@playwright/test';

type Role = 'investor' | 'company' | 'both';

const EMPTY = { results: [], count: 0, next: null, previous: null };
const LONG_NAME = 'HARBOUR ROBOTICS AND AUTONOMOUS MARINE SYSTEMS HOLDINGS PTY LTD';

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
    return answer(EMPTY);
  });
}

async function openTheSidebar(page: Page, role: Role) {
  await serveASignedInAccount(page, role);
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Holdings' })).toBeVisible();
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: 'Open navigation' }).click();
  const aside = page.locator('aside').filter({ visible: true });
  await expect(aside).toHaveCount(1);
  await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  await expect(aside.getByRole('button', { name: 'Company', exact: true })).toBeVisible();
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
  expect(await list.evaluate((node) => node.nextElementSibling === node.parentElement.lastElementChild)).toBe(true);
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
      viewport: { width: 390, height: 600 },
      roles: ['investor', 'company', 'both'] as Role[],
    },
    { name: 'the desktop sidebar', viewport: { width: 1440, height: 900 }, roles: ['both'] as Role[] },
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
