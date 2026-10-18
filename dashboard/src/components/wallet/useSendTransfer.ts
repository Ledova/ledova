import { useContext } from 'react';
import { SendTransferContext, type SendTransferContextValue } from './SendTransferContext';

export function useSendTransfer(): SendTransferContextValue {
  const context = useContext(SendTransferContext);
  if (!context) {
    throw new Error('useSendTransfer must be used within a SendTransferProvider');
  }
  return context;
}
