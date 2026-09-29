import { formatPlainDecimal } from '../../src/utils/formatting';

it.each([
  [5e-7, 8, '0.0000005'],
  [0.0000205 - 0.00002, 8, '0.0000005'],
  [0.000001 * 0.9, 8, '0.0000009'],
  [1e-9, 8, '0'],
  [0.1 + 0.2, 8, '0.3'],
  [1.5, 8, '1.5'],
  [100, 8, '100'],
  [100, 0, '100'],
  [1234.5, 2, '1234.5'],
])('writes %p to at most %i decimals as %p, without an exponent', (value, decimals, written) => {
  expect(formatPlainDecimal(value, decimals)).toBe(written);
});
