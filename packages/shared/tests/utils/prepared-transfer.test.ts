import { canonicalDecimal, tokenBaseUnits, validatePreparedTransfer } from '../../src/utils/prepared-transfer';

const TYPED = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const CHECKSUMMED = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const RECIPIENT = 'The prepared transfer does not match what you entered: the recipient is different.';
const AMOUNT = 'The prepared transfer does not match what you entered: the amount is different.';
const TOKEN = 'The prepared transfer does not match what you entered: the token is different.';
const CONTRACT = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';
const CONTRACT_CHECKSUMMED = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER_CONTRACT = `0x${'5'.repeat(40)}`;
const AT_ONCE_MS = 1000;

it.each([
  ['a native send', { toAddress: CHECKSUMMED, amountEth: '9.99999999' }, { toAddress: TYPED, amountEth: '9.99999999' }],
  [
    'a native amount written differently',
    { toAddress: TYPED, amountEth: '0.10' },
    { toAddress: TYPED, amountEth: '.1' },
  ],
  [
    'a token send, its contract written in another case',
    { toAddress: TYPED, amountToken: '1.5', tokenContract: CONTRACT_CHECKSUMMED },
    { toAddress: TYPED, amountToken: '1.50', tokenContract: CONTRACT },
  ],
])('passes %s that is what was entered', (_, prepared, entered) => {
  expect(() => validatePreparedTransfer(prepared, entered, 2)).not.toThrow();
});

it.each([
  ['1.500 of a two-decimal token', { amountToken: '1.500' }, { amountToken: '1.500' }, 2],
  ['5.0 of a whole-unit token', { amountToken: '5.0' }, { amountToken: '5.0' }, 0],
  ['1e-7 ETH', { amountEth: '0.0000001' }, { amountEth: '1e-7' }, 2],
  ['1E-7 ETH', { amountEth: '0.0000001' }, { amountEth: '1E-7' }, 2],
])('passes %s, which the backend accepts and echoes', (_, prepared, entered, decimals) => {
  expect(() =>
    validatePreparedTransfer({ toAddress: TYPED, ...prepared }, { toAddress: TYPED, ...entered }, decimals),
  ).not.toThrow();
});

it.each([
  ['1.500', 2, 150n],
  ['5.0', 0, 5n],
  ['1e-7', 18, 100000000000n],
  ['1E-7', 18, 100000000000n],
  ['0.0000001', 18, 100000000000n],
  ['1.5e-17', 18, 15n],
  ['10e-19', 18, 1n],
  ['1e+2', 0, 100n],
  ['+.5', 2, 50n],
  ['5.', 2, 500n],
  [' 1.5\n', 2, 150n],
  ['1_000.5', 2, 100050n],
  [((1n << 256n) - 1n).toString(), 0, (1n << 256n) - 1n],
])('reads %p at %i decimals as %s base units, as the backend does', (amount, decimals, units) => {
  expect(tokenBaseUnits(amount, decimals)).toBe(units);
});

it.each([
  ['0', 2],
  ['0.000', 2],
  ['-1', 2],
  ['-0', 2],
  ['1.555', 2],
  ['1.23e-18', 18],
  ['1e-19', 18],
  ['Infinity', 2],
  ['NaN', 2],
  ['1,5', 2],
  ['1 5', 2],
  ['.', 2],
  ['e5', 2],
  ['5e', 2],
  ['0x10', 2],
  ['', 2],
  [undefined, 2],
  [(1n << 256n).toString(), 0],
  [`1${'0'.repeat(77)}`, 2],
  ['1e1000000', 0],
  ['1e9999999999', 0],
  ['1e-1000000', 18],
])('refuses %p at %i decimals, as the backend does', (amount, decimals) => {
  expect(tokenBaseUnits(amount, decimals)).toBeNull();
});

it.each([
  [`1${'0'.repeat(100)}e-100`, 18, 10n ** 18n],
  [`0.${'0'.repeat(99)}1e+100`, 0, 1n],
  [`1${'0'.repeat(101)}e-101`, 18, null],
  [`0.${'0'.repeat(100)}1e+101`, 0, null],
])('reads an exponent up to 100, which covers every asset, and refuses one beyond it', (amount, decimals, units) => {
  expect(tokenBaseUnits(amount, decimals)).toBe(units);
});

it.each([
  ['100000 spaces inside it', `1${' '.repeat(100000)}2`, null],
  ['100000 spaces around it', `${' '.repeat(100000)}1.5${' '.repeat(100000)}`, 150n],
  ['a fraction of 100000 digits', `0.${'0'.repeat(99999)}1`, null],
])('reads an amount with %s at once', (_, amount, units) => {
  const started = performance.now();
  expect(tokenBaseUnits(amount, 2)).toBe(units);
  expect(performance.now() - started).toBeLessThan(AT_ONCE_MS);
});

it.each([
  [
    'another recipient',
    { toAddress: `0x${'5'.repeat(40)}`, amountEth: '0.1' },
    { toAddress: TYPED, amountEth: '0.1' },
    RECIPIENT,
  ],
  ['no recipient', { amountEth: '0.1' }, { toAddress: TYPED, amountEth: '0.1' }, RECIPIENT],
  ['0.5 ETH for 0.1 typed', { toAddress: TYPED, amountEth: '0.5' }, { toAddress: TYPED, amountEth: '0.1' }, AMOUNT],
  [
    'one wei more',
    { toAddress: TYPED, amountEth: '0.100000000000000001' },
    { toAddress: TYPED, amountEth: '0.1' },
    AMOUNT,
  ],
  ['another token amount', { toAddress: TYPED, amountToken: '15' }, { toAddress: TYPED, amountToken: '1.5' }, AMOUNT],
  [
    'a native amount for a token entry',
    { toAddress: TYPED, amountEth: '1.5' },
    { toAddress: TYPED, amountToken: '1.5' },
    AMOUNT,
  ],
  [
    'a typed amount finer than the token',
    { toAddress: TYPED, amountToken: '1.555' },
    { toAddress: TYPED, amountToken: '1.555' },
    AMOUNT,
  ],
  ['an unreadable amount', { toAddress: TYPED, amountEth: '1,5' }, { toAddress: TYPED, amountEth: '1,5' }, AMOUNT],
  [
    'another token contract',
    { toAddress: TYPED, amountToken: '1.5', tokenContract: OTHER_CONTRACT },
    { toAddress: TYPED, amountToken: '1.5', tokenContract: CONTRACT },
    TOKEN,
  ],
  [
    'a token send without its contract',
    { toAddress: TYPED, amountToken: '1.5' },
    { toAddress: TYPED, amountToken: '1.5', tokenContract: CONTRACT },
    TOKEN,
  ],
  [
    'a token contract for a native entry',
    { toAddress: TYPED, amountEth: '1.5', tokenContract: CONTRACT },
    { toAddress: TYPED, amountEth: '1.5' },
    TOKEN,
  ],
])('refuses %s', (_, prepared, entered, message) => {
  expect(() => validatePreparedTransfer(prepared, entered, 2)).toThrow(message);
});

it.each([
  ['0.2500000000000000000000', '0.25'],
  ['1.5000', '1.5'],
  ['100.000', '100'],
  ['100', '100'],
  ['1.', '1'],
  ['.5', '0.5'],
  ['0.0000001', '0.0000001'],
  ['1E-7', '0.0000001'],
  ['2.50000000000000000000E-7', '0.00000025'],
  ['1.5e3', '1500'],
  [' 1_000.50\u00a0', '1000.5'],
  ['+007.10', '7.1'],
  ['-0.50', '-0.5'],
])(
  'writes %p in canonical form as %p, the same number as a plain decimal without trailing zeros',
  (amount, canonical) => {
    expect(canonicalDecimal(amount)).toBe(canonical);
  },
);

it.each(['', '.', '1.2.3', 'e5', 'ten'])('leaves %p, which is no amount, as it is', (amount) => {
  expect(canonicalDecimal(amount)).toBe(amount);
});

it.each([
  ['1E-100', `0.${'0'.repeat(99)}1`],
  ['1E+100', `1${'0'.repeat(100)}`],
])('writes %p, at the largest exponent any asset can use, in canonical form', (amount, canonical) => {
  expect(canonicalDecimal(amount)).toBe(canonical);
});

it.each(['1E-101', '1E+101', '1E-100000', '1E+100000', '1E-10000000'])(
  'leaves %p, whose exponent no asset can use, as it is, at once',
  (amount) => {
    const started = performance.now();
    expect(canonicalDecimal(amount)).toBe(amount);
    expect(performance.now() - started).toBeLessThan(AT_ONCE_MS);
  },
);

it.each([
  ['a fraction of 100000 digits', `0.${'0'.repeat(99999)}1`, `0.${'0'.repeat(99999)}1`],
  ['100000 zeros after its digits', `1.5${'0'.repeat(100000)}`, '1.5'],
  ['100000 zeros before its digits', `${'0'.repeat(100000)}1.5`, '1.5'],
  ['100000 spaces inside it', `1${' '.repeat(100000)}2`, `1${' '.repeat(100000)}2`],
  ['100000 spaces around it', `${' '.repeat(100000)}1.50${' '.repeat(100000)}`, '1.5'],
])('writes an amount with %s at once', (_, amount, canonical) => {
  const started = performance.now();
  expect(canonicalDecimal(amount)).toBe(canonical);
  expect(performance.now() - started).toBeLessThan(AT_ONCE_MS);
});
