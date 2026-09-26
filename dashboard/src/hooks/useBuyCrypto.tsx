import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSelectedPortfolio } from './useSelectedPortfolio';
import { BuyCryptoModal } from '@pages/wallets/components/BuyCryptoModal';
import { BuyCryptoWidgetModal } from '@pages/wallets/components/BuyCryptoWidgetModal';

interface BuyCryptoContextValue {
  openBuyCrypto: () => void;
}

const BuyCryptoContext = createContext<BuyCryptoContextValue | null>(null);

export function BuyCryptoProvider({ children }: { children: ReactNode }) {
  const { userAccount } = useSelectedPortfolio();
  const queryClient = useQueryClient();
  const userAccountUuid = userAccount?.uuid;

  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);

  const openBuyCrypto = useCallback(() => {
    setBuyModalOpen(true);
  }, []);

  const handleBuyModalClose = useCallback(() => {
    setBuyModalOpen(false);
  }, []);

  const handleNavigateToWidget = useCallback((url: string) => {
    setBuyModalOpen(false);
    setWidgetUrl(url);
    setWidgetModalOpen(true);
  }, []);

  const handleWidgetClose = useCallback(() => {
    setWidgetModalOpen(false);
    setWidgetUrl(null);
  }, []);

  const handleWidgetComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['wallets'] });
  }, [queryClient]);

  return (
    <BuyCryptoContext.Provider value={{ openBuyCrypto }}>
      {children}

      <BuyCryptoModal
        isOpen={buyModalOpen}
        onClose={handleBuyModalClose}
        onNavigateToWidget={handleNavigateToWidget}
        userAccountUuid={userAccountUuid}
      />

      <BuyCryptoWidgetModal
        isOpen={widgetModalOpen}
        onClose={handleWidgetClose}
        onComplete={handleWidgetComplete}
        widgetUrl={widgetUrl}
      />
    </BuyCryptoContext.Provider>
  );
}

export function useBuyCrypto(): BuyCryptoContextValue {
  const context = useContext(BuyCryptoContext);
  if (!context) {
    throw new Error('useBuyCrypto must be used within a BuyCryptoProvider');
  }
  return context;
}
