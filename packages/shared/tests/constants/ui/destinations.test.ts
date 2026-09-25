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
