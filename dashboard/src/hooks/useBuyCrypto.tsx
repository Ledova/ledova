import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canOpen, useUserPreferences } from '@ledova/shared';
import { BuyCryptoModal } from '@pages/wallets/components/BuyCryptoModal';
import { BuyCryptoWidgetModal } from '@pages/wallets/components/BuyCryptoWidgetModal';

interface BuyCryptoContextValue {
  openBuyCrypto: () => void;
  canBuyCrypto: boolean;
}

const BuyCryptoContext = createContext<BuyCryptoContextValue | null>(null);

export function BuyCryptoProvider({ children }: { children: ReactNode }) {
  const { userAccount } = useUserPreferences();
  const queryClient = useQueryClient();
  const userAccountUuid = userAccount?.uuid;
  const canBuyCrypto = !!userAccountUuid && !!userAccount && canOpen(userAccount.role, 'investing');
  const scope = useMemo(() => ({ userAccountUuid, canBuyCrypto }), [userAccountUuid, canBuyCrypto]);
  const current = useRef(scope);
  useLayoutEffect(() => {
    current.current = scope;
  }, [scope]);
  const [flow, setFlow] = useState<{ scope: typeof scope; buyOpen: boolean; url: string | null } | null>(null);
  const admitted = canBuyCrypto && flow?.scope === scope;

  const openBuyCrypto = useCallback(() => {
    if (scope.canBuyCrypto && current.current === scope) setFlow({ scope, buyOpen: true, url: null });
  }, [scope]);

  const handleBuyModalClose = useCallback(() => {
    setFlow(null);
  }, []);

  const handleNavigateToWidget = useCallback(
    (url: string) => {
      if (scope.canBuyCrypto && current.current === scope) setFlow({ scope, buyOpen: false, url });
    },
    [scope],
  );

  const handleWidgetClose = useCallback(() => {
    setFlow(null);
  }, []);

  const handleWidgetComplete = useCallback(() => {
    if (scope.canBuyCrypto && current.current === scope) queryClient.invalidateQueries({ queryKey: ['wallets'] });
  }, [queryClient, scope]);

  return (
    <BuyCryptoContext.Provider value={{ openBuyCrypto, canBuyCrypto }}>
      {children}

      {admitted && flow?.buyOpen && (
        <BuyCryptoModal
          isOpen
          onClose={handleBuyModalClose}
          onNavigateToWidget={handleNavigateToWidget}
          userAccountUuid={userAccountUuid}
        />
      )}

      {admitted && flow?.url && (
        <BuyCryptoWidgetModal
          isOpen
          onClose={handleWidgetClose}
          onComplete={handleWidgetComplete}
          widgetUrl={flow.url}
        />
      )}
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
