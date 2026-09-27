import { describe, expect, it } from 'vitest';
import { raisedSupply, requestShares, wholeShares } from './shareQuantities';

describe('exact share quantities and the existing request limit', () => {
  it.each([
    ['2147483646', 2147483646],
    ['2147483647', 2147483647],
    ['2147483648', null],
    ['9007199254740993', null],
    ['1', 1],
    ['00001', 1],
  ] as const)('validates %s before converting a request quantity', (input, expected) => {
    expect(requestShares(input)).toBe(expected);
  });
  it.each(['', '-1', '0', '1.2', '1e3', '+1', ' 1', '1 '])('refuses non-positive or non-whole request %j', (input) => {
    expect(requestShares(input)).toBeNull();
  });
  it('keeps an existing large authorised supply exact even when it cannot fit a new request', () => {
    expect(wholeShares('9007199254740993')).toBe(9007199254740993n);
    expect(raisedSupply('9007199254740993', '2')).toBe('9007199254740995');
    expect(requestShares(raisedSupply('9007199254740993', '2')!)).toBeNull();
  });
  it('calculates the new cap at and above the supported boundary', () => {
    expect(raisedSupply('2147483646', '1')).toBe('2147483647');
    expect(requestShares(raisedSupply('2147483646', '1')!)).toBe(2147483647);
    expect(raisedSupply('2147483646', '2')).toBe('2147483648');
    expect(requestShares(raisedSupply('2147483646', '2')!)).toBeNull();
    expect(raisedSupply('1.5', '1')).toBeNull();
    expect(raisedSupply('1', '0')).toBeNull();
  });
});
