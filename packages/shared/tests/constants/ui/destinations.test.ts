import { canOpen, DESTINATIONS, landingFor, type Audience } from '../../../src/constants/ui/destinations';
import type { AccountRole } from '../../../src/types/domain/user-preferences';

const EVERY_AUDIENCE: Audience[] = ['everyone', 'investing', 'company'];
const UNDEFINED_ROLES = ['', 'staff', 'Investor', 'toString', '__proto__'] as unknown as AccountRole[];

describe('where a signed-in person lands', () => {
  it('sends an investor to their home', () => {
    expect(landingFor('investor')).toBe(DESTINATIONS.home.path);
  });

  it.each(['company', 'both'] as const)('sends a %s account to Register', (role) => {
    expect(landingFor(role)).toBe(DESTINATIONS.companyRegister.path);
  });

  it.each(UNDEFINED_ROLES)('sends a role the API does not define (%p) to Holdings', (role) => {
    expect(landingFor(role)).toBe(DESTINATIONS.home.path);
  });

  it.each<AccountRole>(['investor', 'company', 'both', ...UNDEFINED_ROLES])(
    'sends a %p account to a page it can open',
    (role) => {
      const landing = Object.values(DESTINATIONS).find((destination) => destination.path === landingFor(role));
      expect(landing && canOpen(role, landing.audience)).toBe(true);
    },
  );
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

  it.each(UNDEFINED_ROLES)('lets a role the API does not define (%p) open only the pages for everyone', (role) => {
    expect(EVERY_AUDIENCE.filter((audience) => canOpen(role, audience))).toEqual(['everyone']);
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
    userProfile: 'everyone',
    settings: 'everyone',
    trading: 'investing',
    directory: 'investing',
    directoryDetail: 'investing',
    subscriptions: 'investing',
    subscriptionDetail: 'investing',
    investorEligibility: 'investing',
    eligibilityRequests: 'investing',
    companyEligibility: 'everyone',
    companyClass: 'company',
    companyRegister: 'company',
    company: 'everyone',
    companyAuthority: 'company',
    companyTeam: 'everyone',
    companyListing: 'everyone',
    companyOffering: 'company',
    companyPublications: 'company',
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
      eligibilityRequests: 'Your company eligibility',
      publications: 'Notices',
      companyClass: 'Share class',
      companyRegister: 'Register',
      company: 'Company',
      companyAuthority: 'Representative authority',
      companyTeam: 'Company team',
      companyEligibility: 'Company eligibility',
      companyListing: 'Activation',
      companyOffering: 'Offerings',
      companyPublications: 'Published to your members',
      userProfile: 'Profile',
      settings: 'Settings',
    });
  });
});
