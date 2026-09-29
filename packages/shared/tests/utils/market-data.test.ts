import { marketAmount, marketQuantity, priceCents } from '../../src/utils/market-data';

it('calculates exact AUD cents and never presents unsafe numeric shares as exact', () => {
  expect(marketAmount('0.29', 9007199254740991)).toBe('AUD 2,612,087,783,874,887.39');
  expect(marketAmount('9999999999999999.99', 2)).toBe('AUD 19,999,999,999,999,999.98');
  expect(marketQuantity(9007199254740992)).toBe('Unavailable');
  expect(marketAmount('1.00', 9007199254740992)).toBe('Unavailable');
});

it('multiplies exact whole-share strings past the safe number range as big integers', () => {
  expect(marketAmount('0.29', 9007199254740993n)).toBe('AUD 2,612,087,783,874,887.97');
  expect(marketAmount('12.5')).toBe('AUD 12.50');
  expect(marketQuantity(1234567)).toBe('1,234,567');
});

it.each(['', '1.', '.5', '0.291', '-1', '1e3', '12,50'])('reads %j as no price', (price) => {
  expect(priceCents(price)).toBeNull();
  expect(marketAmount(price)).toBe('Unavailable');
});

it.each([
  ['0', 0n],
  ['0.5', 50n],
  ['12.50', 1250n],
  ['9999999999999999.99', 999999999999999999n],
])('reads %s as %s cents', (price, cents) => {
  expect(priceCents(price)).toBe(cents);
});

it('refuses negative quantities', () => {
  expect(marketQuantity(-1)).toBe('Unavailable');
  expect(marketAmount('1.00', -1)).toBe('Unavailable');
  expect(marketAmount('1.00', -1n)).toBe('Unavailable');
});
