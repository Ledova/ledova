import { REGISTER_IMPORT_COPY } from '../../../src/constants/business/register-imports';

describe('an unconfirmed preparation receipt', () => {
  it('sends the person to the imports on Register, not to a reload that would drop the open draft', () => {
    expect(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED).toMatch(/Check the imports on Register/);
    expect(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED).not.toMatch(/refresh|reload/i);
  });
});
