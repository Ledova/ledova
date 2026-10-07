import { REGISTER_COPY } from '../../../src/constants/business/register';

it('says a completed issue or transfer can wait for a wallet link, without calling the link reviewed', () => {
  expect(REGISTER_COPY.WAITING_NOTE(2)).toMatch(/such as one whose wallet is not yet linked to a member/);
  expect(REGISTER_COPY.WAITING_NOTE(2)).not.toMatch(/reviewed/);
});
