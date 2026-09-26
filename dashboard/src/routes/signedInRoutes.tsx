import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';
import { DESTINATIONS, type DestinationKey } from '@ledova/shared';

import { PageTitle } from '@components/PageTitle';
import { ProtectedRoute } from './ProtectedRoute';

export function signedInRoutes(pages: Record<DestinationKey, ReactElement>) {
  return (Object.keys(pages) as DestinationKey[]).map((key) => (
    <Route
      key={key}
      path={DESTINATIONS[key].path}
      element={
        <ProtectedRoute audience={DESTINATIONS[key].audience}>
          <PageTitle.Provider value={DESTINATIONS[key].title}>{pages[key]}</PageTitle.Provider>
        </ProtectedRoute>
      }
    />
  ));
}
