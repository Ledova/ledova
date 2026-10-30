import type { CreateWallet } from '../../types/domain/wallet';

export const BLOCKCHAIN = {
  ETHEREUM: 'ethereum',
  BITCOIN: 'bitcoin',
  BASE: 'base',
  POLYGON: 'polygon',
  SOLANA: 'solana',
  AVALANCHE: 'avalanche',
} as const;

export type BlockchainType = (typeof BLOCKCHAIN)[keyof typeof BLOCKCHAIN];

export type ChainConfig = {
  name: string;
  shortName: string;
  explorerTxUrl: string;
  explorerAddressUrl: string;
  addressPlaceholder: string;
  confirmationTime: string;
} & ({ isActive: true; code: CreateWallet['chain'] } | { isActive: false; code: BlockchainType });

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    code: BLOCKCHAIN.ETHEREUM,
    name: 'Ethereum',
    shortName: 'ETH',
    isActive: true,
    explorerTxUrl: 'https://sepolia.etherscan.io/tx/',
    explorerAddressUrl: 'https://sepolia.etherscan.io/address/',
    addressPlaceholder: '0x…',
    confirmationTime: '~2-3 minutes',
  },
  {
    code: BLOCKCHAIN.BITCOIN,
    name: 'Bitcoin',
    shortName: 'BTC',
    isActive: true,
    explorerTxUrl: 'https://blockstream.info/testnet/tx/',
    explorerAddressUrl: 'https://blockstream.info/testnet/address/',
    addressPlaceholder: 'm…, n…, 2…, tb1… or bcrt1…',
    confirmationTime: '~10 minutes',
  },
  {
    code: BLOCKCHAIN.BASE,
    name: 'Base',
    shortName: 'BASE',
    isActive: true,
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    explorerAddressUrl: 'https://sepolia.basescan.org/address/',
    addressPlaceholder: '0x…',
    confirmationTime: '~2 seconds',
  },
  {
    code: BLOCKCHAIN.POLYGON,
    name: 'Polygon',
    shortName: 'MATIC',
    isActive: false,
    explorerTxUrl: '',
    explorerAddressUrl: '',
    addressPlaceholder: '0x…',
    confirmationTime: '~2 minutes',
  },
  {
    code: BLOCKCHAIN.SOLANA,
    name: 'Solana',
    shortName: 'SOL',
    isActive: false,
    explorerTxUrl: '',
    explorerAddressUrl: '',
    addressPlaceholder: 'Enter address',
    confirmationTime: '~1 minute',
  },
  {
    code: BLOCKCHAIN.AVALANCHE,
    name: 'Avalanche',
    shortName: 'AVAX',
    isActive: false,
    explorerTxUrl: '',
    explorerAddressUrl: '',
    addressPlaceholder: '0x…',
    confirmationTime: '~2 minutes',
  },
];

const chainByCode = new Map(SUPPORTED_CHAINS.map((c) => [c.code, c]));
function resolveChainConfig(chain: string): ChainConfig | undefined {
  const normalized = chain?.toLowerCase() || '';
  const config = chainByCode.get(normalized as BlockchainType);
  if (config) return config;
  const aliases: Record<string, BlockchainType> = { btc: BLOCKCHAIN.BITCOIN, eth: BLOCKCHAIN.ETHEREUM };
  return aliases[normalized] ? chainByCode.get(aliases[normalized]) : undefined;
}

export function getBlockExplorerTxUrl(chain: string, txHash: string): string {
  const config = resolveChainConfig(chain);
  return config?.explorerTxUrl ? `${config.explorerTxUrl}${txHash}` : '';
}

export function getBlockExplorerAddressUrl(chain: string, address: string): string {
  const config = resolveChainConfig(chain);
  return config?.explorerAddressUrl ? `${config.explorerAddressUrl}${address}` : '';
}
