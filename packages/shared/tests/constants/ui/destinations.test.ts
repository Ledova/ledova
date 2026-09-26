import { canOpen, DESTINATIONS, landingFor, type Audience } from '../../../src/constants/ui/destinations';

const EVERY_AUDIENCE: Audience[] = ['everyone', 'investing', 'company'];

describe('where a signed-in person lands', () => {
  it('sends an investor to their home', () => {
    expect(landingFor('investor')).toBe(DESTINATIONS.home.path);
  });

  it.each(['company', 'both'] as const)('sends a %s account to the company', (role) => {
    expect(landingFor(role)).toBe(DESTINATIONS.company.path);
  });

  it.each(['investor', 'company', 'both'] as const)('sends a %s account to a page it can open', (role) => {
    const landing = Object.values(DESTINATIONS).find((destination) => destination.path === landingFor(role));
    expect(landing && canOpen(role, landing.audience)).toBe(true);
  });
});

describe('who can open a page', () => {
  it('lets a dual-role account open every page', () => {
    expect(EVERY_AUDIENCE.filter((audience) => canOpen('both', audience))).toEqual(EVERY_AUDIENCE);
  });

  it('lets an investor open the pages for everyone and for investing, and not the company pages', () => {
    expect(EVERY_AUDIENCE.filter((audience) => canOpen('investor', audience))).toEqual(['everyone', 'investing']);
  });

  it('lets a company open the pages for everyone and for companies, and not the investing pages', () => {
    expect(EVERY_AUDIENCE.filter((audience) => canOpen('company', audience))).toEqual(['everyone', 'company']);
  });
});

describe('the signed-in destinations', () => {
  it('gives every page its own address', () => {
    const paths = Object.values(DESTINATIONS).map((destination) => destination.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every page a title', () => {
    expect(Object.values(DESTINATIONS).filter((destination) => destination.title.trim() === '')).toEqual([]);
  });
});

describe("the owner's menus of 26 September, applied to today's pages", () => {
  const AUDIENCE_OF_EACH_PAGE: Record<keyof typeof DESTINATIONS, Audience> = {
    home: 'everyone',
    wallets: 'everyone',
    transactions: 'everyone',
    publications: 'everyone',
    dividends: 'everyone',
    userProfile: 'everyone',
    settings: 'everyone',
    trading: 'investing',
    directory: 'investing',
    directoryDetail: 'investing',
    subscriptions: 'investing',
    subscriptionDetail: 'investing',
    investorEligibility: 'investing',
    company: 'company',
    companyListing: 'company',
    companyOffering: 'company',
  };

  it.each(Object.entries(AUDIENCE_OF_EACH_PAGE))('opens %s to %s', (key, audience) => {
    expect(DESTINATIONS[key as keyof typeof DESTINATIONS].audience).toBe(audience);
  });

  it('names each page as the owner chose', () => {
    expect(
      Object.fromEntries(Object.entries(DESTINATIONS).map(([key, destination]) => [key, destination.title])),
    ).toEqual({
      home: 'Holdings',
      wallets: 'Wallets',
      transactions: 'Activity',
      trading: 'Market',
      directory: 'Directory',
      directoryDetail: 'Directory',
      subscriptions: 'Applications',
      subscriptionDetail: 'Application',
      investorEligibility: 'Verification',
      publications: 'Notices',
      dividends: 'Dividends',
      company: 'Company',
      companyListing: 'Application',
      companyOffering: 'Offerings',
      userProfile: 'Profile',
      settings: 'Settings',
    });
  });
});
