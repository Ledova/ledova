import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';
import { DESTINATIONS, type Audience, type DestinationKey } from '@ledova/shared';

import { PageBack, PageTitle, type PageBackLink } from '@components/PageTitle';
import { backLink, pageTitle } from '@utils/destinations';
import { ProtectedRoute } from './ProtectedRoute';

export function signedInPage(page: ReactElement, title: string, audience: Audience, back?: PageBackLink) {
  return (
    <PageTitle.Provider value={title}>
      <PageBack.Provider value={back}>
        <ProtectedRoute audience={audience}>{page}</ProtectedRoute>
      </PageBack.Provider>
    </PageTitle.Provider>
  );
}

export function signedInRoutes(pages: Record<DestinationKey, ReactElement>) {
  return (Object.keys(pages) as DestinationKey[]).map((key) => (
    <Route
      key={key}
      path={DESTINATIONS[key].path}
      element={signedInPage(pages[key], pageTitle(key), DESTINATIONS[key].audience, backLink(key))}
    />
  ));
}
