import { DIRECTORY_COPY } from '../../../src/constants/business/directory';

const OPT_IN = /opted in|opts in/i;
const DEPLOYED = /deployed/i;

describe('the market empty state', () => {
  it('names only deployment, which is its only condition', () => {
    expect(DIRECTORY_COPY.MARKET_EMPTY_BODY).toMatch(DEPLOYED);
    expect(DIRECTORY_COPY.MARKET_EMPTY_BODY).not.toMatch(OPT_IN);
  });
});
