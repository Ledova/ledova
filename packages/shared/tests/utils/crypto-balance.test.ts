import { formatCryptoBalance } from '../../src/utils/formatting';

describe('formatCryptoBalance', () => {
  it.each([
    ['0.000000000000000000', 'ETH', '0 ETH'],
    ['0.25', 'ETH', '0.25 ETH'],
    ['1.000000000000000000', 'ETH', '1 ETH'],
    ['0.001', 'BTC', '0.001 BTC'],
    ['0.000000004', 'BTC', '0 BTC'],
    ['-1.50', 'ETH', '-1.5 ETH'],
    ['-0.000000004', 'BTC', '0 BTC'],
  ])('shows the balance %s in %s as %s, to at most eight places', (balance, symbol, shown) => {
    expect(formatCryptoBalance(balance, symbol)).toBe(shown);
  });

  it('rounds a decimal string exactly, beyond the figures a float can hold', () => {
    expect(formatCryptoBalance('9007199254740993.123456789', 'ETH')).toBe('9007199254740993.12345679 ETH');
    expect(formatCryptoBalance('9007199254740993.000000000000000001', 'ETH')).toBe('9007199254740993 ETH');
    expect(formatCryptoBalance('0.123456785', 'ETH')).toBe('0.12345679 ETH');
  });

  it('leaves a bare figure when there is no unit, and formats numbers as before', () => {
    expect(formatCryptoBalance('5', '').trimEnd()).toBe('5');
    expect(formatCryptoBalance(0.1 + 0.2, 'ETH')).toBe('0.3 ETH');
    expect(formatCryptoBalance(0, 'BTC')).toBe('0 BTC');
  });
});
