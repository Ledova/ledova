import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';
import { DESTINATIONS, type DestinationKey } from '@ledova/shared';

import { PageBack, PageTitle } from '@components/PageTitle';
import { backLink, pageTitle } from '@utils/destinations';
import { ProtectedRoute } from './ProtectedRoute';

export function signedInRoutes(pages: Record<DestinationKey, ReactElement>) {
  return (Object.keys(pages) as DestinationKey[]).map((key) => (
    <Route
      key={key}
      path={DESTINATIONS[key].path}
      element={
        <PageTitle.Provider value={pageTitle(key)}>
          <PageBack.Provider value={backLink(key)}>
            <ProtectedRoute audience={DESTINATIONS[key].audience}>{pages[key]}</ProtectedRoute>
          </PageBack.Provider>
        </PageTitle.Provider>
      }
    />
  ));
}
