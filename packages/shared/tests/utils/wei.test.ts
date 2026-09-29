import { readWei } from '../../src/utils/wei';

it.each([
  ['0x0', 0n],
  ['0x38d7ea4c68000', 10n ** 15n],
  ['0x8ac7230235dc1c00', 9999999990000000000n],
  [`0x${'f'.repeat(64)}`, (1n << 256n) - 1n],
  [0, 0n],
  [1000, 1000n],
  [Number.MAX_SAFE_INTEGER, 9007199254740991n],
])('reads %p as %s wei', (value, wei) => {
  expect(readWei(value)).toBe(wei);
});

it.each([
  ['a decimal string', '1000000000000000'],
  ['a leading zero', '0x038d7ea4c68000'],
  ['upper-case digits', '0x38D7EA4C68000'],
  ['a bare prefix', '0x'],
  ['more than 256 bits', `0x1${'0'.repeat(64)}`],
  ['a number above 2^53 - 1', 2 ** 53],
  ['a fraction', 0.5],
  ['a negative number', -1],
  ['nothing', undefined],
])('refuses %s', (_, value) => {
  expect(readWei(value)).toBeNull();
});
