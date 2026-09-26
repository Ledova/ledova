import { Navigate } from 'react-router-dom';
import { landingFor } from '@ledova/shared';
import { useFeatureFlags } from '@hooks/useFeatureFlags';
import { useRole } from '@hooks/useRole';
import { Page } from '@components/Page';
import TradingPage from '@pages/trading';

export function TradingRoute() {
  const { tradingEnabled, isLoading } = useFeatureFlags();
  const { role } = useRole();

  if (isLoading) {
    return <Page loading />;
  }

  if (!tradingEnabled) {
    return <Navigate to={landingFor(role)} replace />;
  }

  return <TradingPage />;
}
