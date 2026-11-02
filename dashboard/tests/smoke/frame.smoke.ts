import { test, expect, type Page } from '@playwright/test';

type Role = 'investor' | 'company' | 'both';

const EMPTY = { results: [], count: 0, next: null, previous: null };
const LONG_NAME = 'HARBOUR ROBOTICS AND AUTONOMOUS MARINE SYSTEMS HOLDINGS PTY LTD';
const LONG_PERSON = 'Ada Augusta Byron King Lovelace Harbour Robotics Company Administrator';
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
    company: { uuid: company.uuid, name: company.name, acn: company.acn },
    name: 'Ada Lovelace',
    residentialAddress: 'Demo address',
    identitySource: 'company_recorded',
    ownership: null,
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
  const otherRecord = {
    ...memberRecord,
    uuid: 'other-record',
    member: 'other-member',
    company: { uuid: 'other-company', name: 'Second Demo Pty Ltd', acn: '929000001' },
    classes: [{ ...memberRecord.classes[0], uuid: 'other-ordinary', shares: '12' }],
  };
  const members = role === 'company' ? [] : role === 'both' ? [memberRecord, otherRecord] : [memberRecord];
  const classes = ['ordinary', 'preference'].map((uuid) => ({ uuid, companyUuid: 'company', companyName: LONG_NAME }));
  const ownership = {
    company: company.uuid,
    companyName: LONG_NAME,
    asAt: '2026-10-26T00:00:00Z',
    complete: true,
    issuedSupply: role === 'company' ? '0' : '140',
    totalHolders: role === 'company' ? 0 : ORDINARY.totalHolders,
    classes:
      role === 'company'
        ? []
        : [
            {
              uuid: 'ordinary',
              name: 'Ordinary shares',
              symbol: 'ORD',
              tokenType: 'ordinary',
              initialized: true,
              issuedSupply: ORDINARY.issuedSupply,
              totalHolders: ORDINARY.totalHolders,
              sequence: 1,
              recordedAt: '2026-10-26T00:00:00Z',
            },
            {
              uuid: 'preference',
              name: 'Preference shares',
              symbol: 'PRF',
              tokenType: 'preference',
              initialized: true,
              issuedSupply: '5',
              totalHolders: 1,
              sequence: 1,
              recordedAt: '2026-10-26T00:00:00Z',
            },
          ],
  };
  await page.route('**/api/**', (route) => {
    const answer = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/tokens/member-records/') reads.memberLists += 1;
    if (path === '/api/v1/company-authority/appointments/') reads.appointments += 1;
    if (path === '/api/v1/companies/') reads.companies += 1;
    if (path === '/api/auth/verify/') return answer({ valid: true });
    if (path === '/api/user-preferences/')
      return answer({ userProfile: 'profile', userAccount: { uuid: 'account', role }, transactionAlerts: false });
    if (path === '/api/user-profiles/')
      return answer({
        ...EMPTY,
        count: 1,
        results: [{ uuid: 'profile', isSignupCompleted: true, fullName: LONG_PERSON, email: 'ada@example.test' }],
      });
    if (path === '/api/v1/companies/')
      return answer({ ...EMPTY, count: role === 'investor' ? 0 : 1, results: role === 'investor' ? [] : [company] });
    if (path === '/api/v1/companies/company/') return answer(company);
    if (path === '/api/v1/tokens/member-records/') return answer({ ...EMPTY, count: members.length, results: members });
    if (path === '/api/v1/tokens/member-records/own-record/') return answer(memberRecord);
    if (path === '/api/v1/tokens/member-records/other-record/') return answer(otherRecord);
    if (path.startsWith('/api/v1/tokens/member-records/') && path.endsWith('/entries/')) return answer({ entries: [] });
    if (path === '/api/v1/company-authority/companies/company/team/') return answer([]);
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
    if (path === '/api/v1/tokens/register/')
      return answer({ ...EMPTY, count: role === 'both' ? classes.length : 0, results: role === 'both' ? classes : [] });
    if (path === '/api/v1/tokens/ownership/') return answer(ownership);
    if (path === '/api/v1/tokens/ordinary/holders/') return answer(ORDINARY);
    if (path === '/api/v1/tokens/preference/holders/')
      return answer({
        ...ORDINARY,
        token: { ...ORDINARY.token, uuid: 'preference', name: 'Preference shares', symbol: 'PRF' },
        issuedSupply: '5',
        totalHolders: 1,
        holders: [{ ...ORDINARY.holders[0], balance: '5', percentage: 100, shareClass: 'PRF' }],
      });
    if (path === '/api/v1/tokens/ordinary/ownership-holders/')
      return answer({
        count: ORDINARY.totalHolders,
        next: null,
        previous: null,
        token: 'ordinary',
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

async function visibleSidebar(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    const opener = page.getByRole('button', { name: 'Open navigation' });
    if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
  }
  const aside = page.locator('aside').filter({ visible: true });
  await expect(aside).toHaveCount(1);
  return aside;
}

async function showAllClasses(page: Page) {
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Share class', exact: true }).selectOption({ label: 'All classes' });
}

async function closeSidebar(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    const opener = page.getByRole('button', { name: 'Open navigation' });
    const closer = page.getByRole('button', { name: 'Close navigation', exact: true });
    if ((await opener.getAttribute('aria-expanded')) === 'true') {
      await expect(closer).toBeVisible();
      await closer.click();
    }
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await expect(closer).not.toBeVisible();
  }
}

async function openTheSidebar(page: Page, role: Role) {
  const reads = await serveASignedInAccount(page, role);
  const companyChoice = page.getByRole('combobox', { name: 'Your companies', exact: true });
  const companySwitch = page.getByRole('button', { name: 'Switch company', exact: true });
  const chooseCompany = async (search: string, name: RegExp) => {
    await expect(companySwitch).toHaveCount(1);
    await expect(companySwitch).toHaveAttribute('title', 'Switch company');
    await expect(companyChoice).toHaveCount(0);
    await companySwitch.click();
    await companyChoice.fill(search);
    await page.getByRole('option', { name }).click();
    await expect(companyChoice).toHaveCount(0);
    await expect(companySwitch).toHaveAttribute('aria-expanded', 'false');
    await expect(companySwitch).toBeFocused();
  };
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();
  if (role === 'both') {
    await expect(page.getByRole('list', { name: 'Your companies', exact: true })).toHaveCount(0);
    await expect(companySwitch).toHaveCount(1);
  } else {
    await expect(page.getByRole('button', { name: 'Switch company', exact: true })).toHaveCount(0);
    await expect(companyChoice).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/home\?company=company$/);
  if (role === 'both') {
    const summary = page.getByRole('region', { name: 'Company ownership summary' });
    await expect(summary).toContainText('Issued shares140');
    await expect(summary).toContainText('Current shareholders2');
    if (page.viewportSize()!.width >= 768)
      await expect(page.locator('main svg:not([aria-hidden="true"])')).toBeVisible();
    await page.getByRole('button', { name: 'Explore Ordinary shares (ORD)', exact: true }).click();
    await expect(page).toHaveURL(/company=company&class=ordinary/);
    const holders = page.getByRole('list', { name: 'Ordinary shares shareholders' });
    await expect(holders.getByRole('button', { name: 'Highlight Founder’s holding' })).toHaveAccessibleDescription(
      '100 shares 74.07% of ORD',
    );
    await expect(holders.getByRole('button', { name: 'Highlight Investor’s holding' })).toHaveAccessibleDescription(
      '35 shares 25.93% of ORD',
    );
    await showAllClasses(page);
    await expect(page.getByRole('button', { name: 'Explore Ordinary shares (ORD)', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Explore Ordinary shares (ORD)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ordinary shares', exact: true })).toBeFocused();
    await chooseCompany('second', /^Second Demo Pty Ltd/);
    await expect(page).toHaveURL(/\/home\?company=other-company$/);
    await expect(page.getByRole('button', { name: 'Explore Ordinary shares (ORD)', exact: true })).toContainText('12');
    let aside = await visibleSidebar(page);
    await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).toHaveCount(0);
    await closeSidebar(page);
    await chooseCompany('harbour robotics', new RegExp(`^${LONG_NAME}`));
    aside = await visibleSidebar(page);
    const documents = aside.getByRole('link', { name: 'Documents', exact: true }).locator('../..');
    await documents.getByRole('button', { name: 'Expand Documents navigation' }).click();
    await expect(documents.getByRole('link', { name: 'Certificates', exact: true })).toHaveAttribute(
      'href',
      '/documents/certificates?company=company',
    );
  } else if (role === 'investor') {
    await expect(page.getByText('Your issued shares', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Explore Ordinary shares (ORD)', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Ordinary shares shareholders' })).toHaveCount(0);
    await expect(
      page.getByText('Only your own holdings and awards are shown. Other shareholders’ records are private.'),
    ).toBeVisible();
    await showAllClasses(page);
    const sidebar = await visibleSidebar(page);
    await expect(sidebar.getByRole('link', { name: 'Documents', exact: true })).toHaveAttribute(
      'href',
      '/documents/certificates?company=company',
    );
    const documents = sidebar.getByRole('link', { name: 'Documents', exact: true }).locator('../..');
    await documents.getByRole('button', { name: 'Expand Documents navigation' }).click();
    await expect(documents.getByRole('link', { name: 'Notices', exact: true })).toHaveAttribute(
      'href',
      '/publications?company=company',
    );
    await expect(sidebar.getByRole('link', { name: 'Eligibility', exact: true })).toHaveAttribute(
      'href',
      '/investor-eligibility?company=company',
    );
  } else {
    await expect(page.getByRole('region', { name: 'Company ownership summary' })).toContainText(
      'Issued sharesNot complete',
    );
  }
  expect(await page.locator('html').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  let aside = await visibleSidebar(page);
  await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0);
  await expect(aside.getByText(LONG_NAME, { exact: true })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute(
    'href',
    '/home?company=company',
  );
  await expect(aside.getByRole('link', { name: 'Ledger', exact: true })).toHaveCount(role === 'investor' ? 0 : 1);
  if (role === 'both') {
    await aside.getByRole('button', { name: 'Expand Ledger navigation' }).click();
    for (const [name, hash] of [
      ['Issue shares', 'issue'],
      ['Transfer shares', 'transfer'],
      ['Corrections', 'corrections'],
    ])
      await expect(aside.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        `/company/ledger?company=company#${hash}`,
      );
    await aside.getByRole('link', { name: 'Corrections', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Corrections', exact: true })).toBeVisible();
    aside = await visibleSidebar(page);
    await expect(aside.getByRole('link', { name: 'Corrections', exact: true })).toHaveAttribute('aria-current', 'page');
    await aside.getByRole('link', { name: 'Ledger', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ledger', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/company\/ledger\?company=company$/);
    await expect(page.getByRole('combobox', { name: 'Company', exact: true })).toHaveCount(0);
    aside = await visibleSidebar(page);
    await aside.getByRole('button', { name: 'Expand Shareholders navigation' }).click();
    await expect(aside.getByRole('link', { name: 'Employee scheme', exact: true })).toHaveAttribute(
      'href',
      '/company/ledger?company=company#awards',
    );
    await aside.getByRole('link', { name: 'Employee scheme', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Employee share scheme', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Company', exact: true })).toHaveCount(0);
    aside = await visibleSidebar(page);
    await aside.getByRole('link', { name: 'Documents', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Certificates', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Company', exact: true })).toHaveCount(0);
    aside = await visibleSidebar(page);
    await expect(aside.getByRole('link', { name: 'Certificates', exact: true })).toHaveAttribute(
      'href',
      '/documents/certificates?company=company&class=ordinary',
    );
    for (const [name, hash] of [
      ['Inspection copies', 'inspection-copies'],
      ['Company pack', 'company-pack'],
    ])
      await expect(aside.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        `/company/ledger?company=company#${hash}`,
      );
    await aside.getByRole('link', { name: 'Inspection copies', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inspection copies', exact: true })).toBeVisible();
    aside = await visibleSidebar(page);
    await aside.getByRole('link', { name: 'Company pack', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Company pack', exact: true })).toBeVisible();
    aside = await visibleSidebar(page);
    await aside.getByRole('button', { name: 'Expand Eligibility navigation' }).click();
    await aside.getByRole('link', { name: 'Supporting', exact: true }).click();
    await expect(page).toHaveURL(/\/documents\/company\?company=company$/);
    await expect(page.getByRole('heading', { name: 'Supporting documents', exact: true })).toBeVisible();
    aside = await visibleSidebar(page);
    await expect(aside.getByRole('link', { name: 'Your eligibility', exact: true })).toHaveAttribute(
      'href',
      '/investor-eligibility?company=company',
    );
  }
  const settings = aside.getByRole('link', { name: 'Settings', exact: true }).locator('../..');
  const settingsLink = settings.getByRole('link', { name: 'Settings', exact: true });
  await expect(settingsLink).toHaveAttribute('href', '/settings?company=company#profile');
  await settings.getByRole('button', { name: 'Expand Settings navigation' }).click();
  for (const [name, hash] of [
    ['Profile', 'profile'],
    ['Account', 'account'],
    ['Data and privacy', 'data'],
  ])
    await expect(settings.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      `/settings?company=company#${hash}`,
    );
  await expect(settings.getByRole('link', { name: 'Team', exact: true })).toHaveCount(role === 'investor' ? 0 : 1);
  await expect(settings.getByRole('link', { name: 'Documents', exact: true })).toHaveCount(0);
  await settingsLink.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /records you$/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Company details', exact: true })).toHaveCount(
    role === 'investor' ? 0 : 1,
  );
  await expect(page.getByRole('heading', { name: 'Personal information', exact: true })).toBeVisible();
  for (const name of ['Account status', 'Security', 'Preferences', 'Data and privacy', 'Supporting payslips'])
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  if (role === 'both') {
    await page.getByRole('button', { name: 'Edit company', exact: true }).click();
    await page.getByRole('textbox', { name: 'Trading name', exact: true }).fill('Unsent company draft');
    await expect(page.getByRole('textbox', { name: 'Trading name', exact: true })).toHaveValue('Unsent company draft');
    aside = await visibleSidebar(page);
    await aside.getByRole('link', { name: 'Dashboard', exact: true }).click();
    const leave = page.getByRole('dialog', { name: 'Leave this page?', exact: true });
    await expect(leave.getByRole('heading', { name: 'Leave this page?', exact: true })).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(leave.getByRole('heading', { name: 'Leave this page?', exact: true })).not.toBeVisible();
    await closeSidebar(page);
    await expect(page.getByRole('textbox', { name: 'Trading name', exact: true })).toHaveValue('Unsent company draft');
    aside = await visibleSidebar(page);
    await aside.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await leave.getByRole('button', { name: 'Leave page', exact: true }).click();
    await expect(page).toHaveURL(/\/home\?company=company$/);
  }
  await page.goto('/settings?company=company#profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
  aside = await visibleSidebar(page);
  await aside.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage account', exact: true })).toBeVisible();
  aside = await visibleSidebar(page);
  await aside.getByRole('link', { name: 'Data and privacy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Data and privacy', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
  aside = await visibleSidebar(page);
  await expect(aside.getByText('More', { exact: true })).toHaveCount(0);
  await expect(aside.getByRole('link', { name: 'Help & Support' })).toHaveCount(0);
  await expect(aside.getByRole('link', { name: 'Wallets', exact: true })).toHaveCount(0);
  await expect(aside.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0);
  expect(reads.memberLists).toBeGreaterThan(0);
  return aside;
}

function bottomOf(box: { y: number; height: number } | null) {
  return box!.y + box!.height;
}

async function checkTheCutEdge(aside: ReturnType<Page['locator']>) {
  const list = aside.locator('nav').locator('..');
  const foot = aside.locator(':scope > :last-child');
  expect(await list.evaluate((node) => node.nextElementSibling === node.parentElement?.lastElementChild)).toBe(true);
  await expect(foot).toContainText('Sign out');
  await expect(foot.getByRole('button', { name: 'Dark theme', exact: true })).toBeVisible();
  await expect(foot).toHaveCSS('border-top-style', 'solid');
  await expect(foot).toHaveCSS('border-top-width', '1px');
  expect(Math.abs((await foot.boundingBox())!.y - bottomOf(await list.boundingBox()))).toBeLessThan(0.5);
  const person = foot.getByText(LONG_PERSON, { exact: true });
  const company = foot.getByText(LONG_NAME, { exact: true });
  for (const [name, label] of [
    [person, LONG_PERSON],
    [company, LONG_NAME],
  ] as const) {
    await expect(name).toHaveAttribute('title', label);
    await expect(name).toHaveCSS('font-size', '12px');
    await expect(name).toHaveCSS('white-space', 'nowrap');
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  }
  expect(await person.evaluate((node) => node.nextElementSibling?.textContent)).toBe(LONG_NAME);
  await expect(aside.getByText(LONG_NAME, { exact: true })).toHaveCount(1);
  const before = await foot.boundingBox();
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const after = await foot.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(await aside.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

test.describe('the signed-in sidebar and compact account footer', () => {
  const layouts = [
    {
      name: 'the phone drawer',
      viewport: { width: 320, height: 600 },
      roles: ['investor', 'company', 'both'] as Role[],
    },
    { name: 'the desktop sidebar', viewport: { width: 1440, height: 600 }, roles: ['both'] as Role[] },
  ];
  for (const layout of layouts)
    for (const role of layout.roles) {
      test(`keeps the ${role} account footer below the contained list in ${layout.name}`, async ({ page }) => {
        await page.setViewportSize(layout.viewport);
        await checkTheCutEdge(await openTheSidebar(page, role));
        if (role === 'investor') {
          await page.goto('/company/team');
          await expect(page.getByRole('heading', { name: 'Accept a company invitation', exact: true })).toBeFocused();
          await expect(page.getByRole('textbox', { name: 'Invitation code', exact: true })).toBeVisible();
        }
      });
    }
});
