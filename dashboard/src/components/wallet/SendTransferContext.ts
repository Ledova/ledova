import { createContext } from 'react';
import type { Wallet } from '@ledova/shared';

export interface SendTransferContextValue {
  openSendTransfer: () => void;
  openSendTransferFrom: (wallet: Wallet) => void;
}

export const SendTransferContext = createContext<SendTransferContextValue | null>(null);
