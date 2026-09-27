import { HOLDING_ASSET_TYPE } from '../constants';
import type { HoldingWithWallet } from '../types';

export interface ShareHoldingRow {
  assetUuid: string;
  name: string;
  companyName: string | null;
  quantity: string;
  chains: Array<{
    chain: string;
    quantity: string;
    wallets: Array<{ uuid: string; name?: string; address: string; quantity: string }>;
  }>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function wholeQuantity(value: string): bigint {
  if (!/^\d+(?:\.0+)?$/.test(value)) {
    throw new Error('Share quantity must be a non-negative whole number.');
  }
  return BigInt(value.replace(/\.0+$/, ''));
}

export function summarizeShareHoldings(input: HoldingWithWallet[]): ShareHoldingRow[] {
  const holdings = input
    .filter((holding) => holding.asset.assetType === HOLDING_ASSET_TYPE.TOKENIZED_SECURITY)
    .sort(
      (left, right) =>
        Number(left.shareClass === null) - Number(right.shareClass === null) ||
        compare(left.shareClass?.companyName ?? '', right.shareClass?.companyName ?? '') ||
        compare(left.shareClass?.name ?? left.assetName, right.shareClass?.name ?? right.assetName) ||
        compare(left.walletInfo.name ?? '', right.walletInfo.name ?? '') ||
        compare(left.walletInfo.address, right.walletInfo.address) ||
        compare(left.walletInfo.uuid, right.walletInfo.uuid),
    );
  const rows = new Map<string, ShareHoldingRow>();

  for (const holding of holdings) {
    if (!holding.assetUuid) {
      throw new Error('Share holding must identify an asset.');
    }
    const quantity = wholeQuantity(holding.quantity);
    if (quantity === 0n) continue;
    let row = rows.get(holding.assetUuid);
    if (!row) {
      row = {
        assetUuid: holding.assetUuid,
        name: holding.shareClass?.name ?? holding.assetName,
        companyName: holding.shareClass?.companyName ?? null,
        quantity: '0',
        chains: [],
      };
      rows.set(holding.assetUuid, row);
    }
    row.quantity = (BigInt(row.quantity) + quantity).toString();
    const chain = holding.chain || holding.walletInfo.chain;
    let chainRow = row.chains.find((entry) => entry.chain === chain);
    if (!chainRow) {
      chainRow = { chain, quantity: '0', wallets: [] };
      row.chains.push(chainRow);
    }
    chainRow.quantity = (BigInt(chainRow.quantity) + quantity).toString();
    let walletRow = chainRow.wallets.find((entry) => entry.uuid === holding.walletInfo.uuid);
    if (!walletRow) {
      walletRow = {
        uuid: holding.walletInfo.uuid,
        name: holding.walletInfo.name ?? undefined,
        address: holding.walletInfo.address,
        quantity: '0',
      };
      chainRow.wallets.push(walletRow);
    }
    walletRow.quantity = (BigInt(walletRow.quantity) + quantity).toString();
  }

  for (const row of rows.values()) {
    row.chains.sort((left, right) => compare(left.chain, right.chain));
    for (const chain of row.chains) {
      chain.wallets.sort(
        (left, right) =>
          compare(left.name ?? '', right.name ?? '') ||
          compare(left.address, right.address) ||
          compare(left.uuid, right.uuid),
      );
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      compare(left.companyName ?? '', right.companyName ?? '') ||
      compare(left.name, right.name) ||
      compare(left.assetUuid, right.assetUuid),
  );
}
