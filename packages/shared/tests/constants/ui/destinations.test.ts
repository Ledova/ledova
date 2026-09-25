import { DESTINATIONS, landingFor } from '../../../src/constants/ui/destinations';

describe('where a signed-in person lands', () => {
  it('sends an investor to their home', () => {
    expect(landingFor('investor')).toBe(DESTINATIONS.home.path);
  });

  it.each(['company', 'both'] as const)('sends a %s account to the company', (role) => {
    expect(landingFor(role)).toBe(DESTINATIONS.company.path);
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
