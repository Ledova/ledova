interface TransferFields {
  toAddress?: string;
  amountEth?: string;
  amountToken?: string;
  tokenContract?: string;
}

const PYTHON_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const SURROUNDING_SPACE = new RegExp(`^${PYTHON_SPACE}+|${PYTHON_SPACE}+$`, 'g');
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const UINT256_LIMIT = 1n << 256n;

export function tokenBaseUnits(amount: string | undefined, decimals: number): bigint | null {
  const match = DECIMAL.exec((amount ?? '').replace(SURROUNDING_SPACE, '').replace(/_/g, ''));
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
