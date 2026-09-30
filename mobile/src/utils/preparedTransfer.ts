import { Interface, isAddress, isHexString, parseUnits } from 'ethers';
import { readWei, type TransactionData, type TransferableAsset } from '@ledova/shared';

const erc20 = new Interface(['function transfer(address to, uint256 amount)']);

function refuse(field: string): never {
  throw new Error(`The prepared transaction has no valid ${field}.`);
}

function differs(reason: string): never {
  throw new Error(`This transaction does not match your review: ${reason}.`);
}

function whole(value: unknown, field: string, accepts: (value: number) => boolean): number {
  return typeof value === 'number' && accepts(value) ? value : refuse(field);
}

const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;

export function preparedTransferTransaction(transaction: unknown) {
  if (typeof transaction !== 'object' || transaction === null)
    throw new Error('The prepared transaction is unavailable.');
  const { to, value, gas, gasPrice, nonce, chainId, data = '0x' } = transaction as Record<string, unknown>;
  if (typeof to !== 'string' || !isHexString(to, 20) || !isAddress(to)) refuse('to address');
  if (typeof data !== 'string' || !isHexString(data, true)) refuse('data');
  return {
    type: 0,
    to,
    value: readWei(value) ?? refuse('value'),
    gasLimit: BigInt(whole(gas, 'gas limit', positive)),
    gasPrice: BigInt(whole(gasPrice, 'gas price', positive)),
    nonce: whole(nonce, 'nonce', count),
    chainId: BigInt(whole(chainId, 'chain id', positive)),
    data,
  };
}

export type TransferTransaction = ReturnType<typeof preparedTransferTransaction>;

export type ReviewedAsset = Pick<TransferableAsset, 'symbol' | 'decimals' | 'contractAddress'>;

function sameAddress(address: string, reviewed: string | undefined) {
  return reviewed !== undefined && address.toLowerCase() === reviewed.toLowerCase();
}

function units(amount: string | undefined, decimals: number) {
  try {
    return amount === undefined ? null : parseUnits(amount, decimals);
  } catch {
    return null;
  }
}

function tokenTransfer(data: string) {
  try {
    const [recipient, amount] = erc20.decodeFunctionData('transfer', data) as unknown as [string, bigint];
    const canonical = erc20.encodeFunctionData('transfer', [recipient, amount]) === data.toLowerCase();
    return canonical ? { recipient, amount } : null;
  } catch {
    return null;
  }
}

export function reviewedTransferTransaction(prepared: TransactionData, asset?: ReviewedAsset): TransferTransaction {
  const transaction = preparedTransferTransaction(prepared.transaction);
  if (!prepared.amountToken) {
    if (!sameAddress(transaction.to, prepared.toAddress)) differs('the recipient is different');
    if (transaction.data !== '0x') differs('it is not a plain transfer');
    if (transaction.value !== units(prepared.amountEth, 18)) differs('the amount is different');
    return transaction;
  }
  if (asset === undefined)
    throw new Error("The token's decimals are unknown, so this transfer cannot be checked against your review.");
  if (!sameAddress(transaction.to, prepared.tokenContract)) differs('it calls a different token contract');
  if (!sameAddress(prepared.tokenContract ?? '', asset.contractAddress)) differs('it calls a different token contract');
  if (transaction.value !== 0n) differs('it also sends ETH');
  const call = tokenTransfer(transaction.data);
  if (!call) differs('it is not a token transfer');
  if (!sameAddress(call.recipient, prepared.toAddress)) differs('the recipient is different');
  if (call.amount !== units(prepared.amountToken, asset.decimals)) differs('the amount is different');
  return transaction;
}

export function reviewTransfer(prepared: TransactionData, asset?: ReviewedAsset) {
  try {
    return { transaction: reviewedTransferTransaction(prepared, asset), error: null };
  } catch (error) {
    return { transaction: null, error: error instanceof Error ? error.message : 'This transaction cannot be signed.' };
  }
}
