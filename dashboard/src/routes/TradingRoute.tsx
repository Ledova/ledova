import { Navigate } from 'react-router-dom';
import { landingFor, useFeatureFlags } from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import { Page } from '@components/Page';
import TradingPage from '@pages/trading';

export function TradingRoute() {
  const { isEnabled, isLoading } = useFeatureFlags();
  const { role } = useRole();

  if (isLoading) {
    return <Page loading />;
  }

  if (!isEnabled('trading_enabled')) {
    return <Navigate to={landingFor(role)} replace />;
  }

  return <TradingPage />;
}
