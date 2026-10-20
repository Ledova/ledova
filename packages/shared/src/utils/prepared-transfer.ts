interface TransferFields {
  toAddress?: string;
  amountEth?: string;
  amountToken?: string;
  tokenContract?: string;
}

const PYTHON_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const SPACE = new RegExp(`^${PYTHON_SPACE}$`);
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const EXPONENT_LIMIT = 100;
const UINT256_LIMIT = 1n << 256n;

function readDecimal(amount: string) {
  let start = 0;
  let end = amount.length;
  while (start < end && SPACE.test(amount.charAt(start))) start += 1;
  while (end > start && SPACE.test(amount.charAt(end - 1))) end -= 1;
  const match = DECIMAL.exec(amount.slice(start, end).replace(/_/g, ''));
  return match && Math.abs(Number(match[4] ?? 0)) <= EXPONENT_LIMIT ? match : null;
}

export function tokenBaseUnits(amount: string | undefined, decimals: number): bigint | null {
  const match = readDecimal(amount ?? '');
  if (!match) return null;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (!(whole + fraction) || sign === '-' || !digits) return null;
  const shift = Number(exponent) - fraction.length + decimals;
  if (digits.length - 1 + shift >= 78) return null;
  if (shift < 0 && /[1-9]/.test(digits.slice(shift))) return null;
  const units = BigInt(shift < 0 ? digits.slice(0, shift) : `${digits}${'0'.repeat(shift)}`);
  return units < UINT256_LIMIT ? units : null;
}

export function canonicalDecimal(amount: string): string {
  const match = readDecimal(amount);
  if (!match || !(match[2] || match[3])) return amount;
  const [, sign, whole = '', fraction = '', exponent = '0'] = match;
  const point = whole.length + Number(exponent);
  const leading = '0'.repeat(Math.max(-point, 0));
  const trailing = '0'.repeat(Math.max(point - whole.length - fraction.length, 0));
  const digits = `${leading}${whole}${fraction}${trailing}`;
  const split = Math.max(point, 0);
  let first = 0;
  while (first < split && digits[first] === '0') first += 1;
  let last = digits.length;
  while (last > split && digits[last - 1] === '0') last -= 1;
  const integer = digits.slice(first, split) || '0';
  const decimals = digits.slice(split, last);
  return `${sign === '-' ? '-' : ''}${integer}${decimals ? `.${decimals}` : ''}`;
}

function mismatch(reason: string): never {
  throw new Error(`The prepared transfer does not match what you entered: ${reason}.`);
}

export function validatePreparedTransfer(
  prepared: TransferFields,
  entered: TransferFields & { toAddress: string },
  tokenDecimals: number,
): void {
  if (prepared.toAddress?.toLowerCase() !== entered.toAddress.toLowerCase()) mismatch('the recipient is different');
  if (prepared.tokenContract?.toLowerCase() !== entered.tokenContract?.toLowerCase())
    mismatch('the token is different');
  const token = entered.amountToken !== undefined;
  const decimals = token ? tokenDecimals : 18;
  const typed = tokenBaseUnits(token ? entered.amountToken : entered.amountEth, decimals);
  if (typed === null || typed !== tokenBaseUnits(token ? prepared.amountToken : prepared.amountEth, decimals))
    mismatch('the amount is different');
}
