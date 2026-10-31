import { LoadError } from './Ledger';
import { Page } from './Page';
import { PageTitle } from './PageTitle';

export function LoadFailure() {
  return (
    <PageTitle.Provider value="Something went wrong">
      <Page>
        <LoadError retry={() => window.location.reload()}>This page could not be loaded.</LoadError>
      </Page>
    </PageTitle.Provider>
  );
}
