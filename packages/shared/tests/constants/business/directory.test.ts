import { DIRECTORY_COPY } from '../../../src/constants/business/directory';

it('describes exact secondary company admission without turning readiness into access to every deployment', () => {
  expect(DIRECTORY_COPY.MARKET_EMPTY_BODY).toMatch(/current company decisions/);
  expect(DIRECTORY_COPY.MARKET_EMPTY_BODY).toMatch(/secondary trading/);
  expect(DIRECTORY_COPY.MARKET_EMPTY_BODY).not.toMatch(/every deployed|none exists/);
  expect(DIRECTORY_COPY.MARKET_INELIGIBLE_BODY).toMatch(/Each company separately decides/);
});
