import { MaxUint256, isAddress, isHexString } from 'ethers';

function refuse(field: string): never {
  throw new Error(`The prepared transaction has no valid ${field}.`);
}

function whole(value: unknown, field: string, accepts: (value: number) => boolean): number {
  return typeof value === 'number' && accepts(value) ? value : refuse(field);
}

const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;

function wei(value: unknown): bigint {
  if (typeof value !== 'string') return BigInt(whole(value, 'value', count));
  return /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= MaxUint256 ? BigInt(value) : refuse('value');
}

export function preparedTransferTransaction(transaction: unknown) {
  if (typeof transaction !== 'object' || transaction === null)
    throw new Error('The prepared transaction is unavailable.');
  const { to, value, gas, gasPrice, nonce, chainId, data = '0x' } = transaction as Record<string, unknown>;
  if (typeof to !== 'string' || !isHexString(to, 20) || !isAddress(to)) refuse('to address');
  if (typeof data !== 'string' || !isHexString(data, true)) refuse('data');
  return {
    type: 0,
    to,
    value: wei(value),
    gasLimit: BigInt(whole(gas, 'gas limit', positive)),
    gasPrice: BigInt(whole(gasPrice, 'gas price', positive)),
    nonce: whole(nonce, 'nonce', count),
    chainId: BigInt(whole(chainId, 'chain id', positive)),
    data,
  };
}
