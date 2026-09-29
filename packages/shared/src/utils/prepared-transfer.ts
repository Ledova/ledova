interface TransferFields {
  toAddress?: string;
  amountEth?: string;
  amountToken?: string;
  tokenContract?: string;
}

function baseUnits(amount: string | undefined, decimals: number): bigint | null {
  const [whole = '', fraction = ''] = /^(\d*)\.?(\d*)$/.exec(amount ?? '')?.slice(1) ?? [];
  if (!(whole + fraction) || fraction.length > decimals) return null;
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
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
  const typed = baseUnits(token ? entered.amountToken : entered.amountEth, decimals);
  if (typed === null || typed !== baseUnits(token ? prepared.amountToken : prepared.amountEth, decimals))
    mismatch('the amount is different');
}
