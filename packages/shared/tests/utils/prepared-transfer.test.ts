import { validatePreparedTransfer } from '../../src/utils/prepared-transfer';

const TYPED = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const CHECKSUMMED = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const RECIPIENT = 'The prepared transfer does not match what you entered: the recipient is different.';
const AMOUNT = 'The prepared transfer does not match what you entered: the amount is different.';
const TOKEN = 'The prepared transfer does not match what you entered: the token is different.';
const CONTRACT = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';
const CONTRACT_CHECKSUMMED = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER_CONTRACT = `0x${'5'.repeat(40)}`;

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
  ['an unreadable amount', { toAddress: TYPED, amountEth: '1e5' }, { toAddress: TYPED, amountEth: '1e5' }, AMOUNT],
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
