import { DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { generatePath } from 'react-router-dom';
import { pageTitle } from '@utils/destinations';
import { Section } from '@components/Ledger';
import { PageLink } from '@components/Page';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function GettingStarted({ classes }: { classes: { uuid: string; initialized: boolean }[] }) {
  const context = useCompanyContext();
  const unfinished = classes.filter((shareClass) => !shareClass.initialized);
  const path =
    unfinished.length === 1
      ? generatePath(DESTINATIONS.companyClass.path, { uuid: unfinished[0].uuid })
      : classes.length
        ? DESTINATIONS.companyRegister.path
        : DESTINATIONS.companyRegisterSetup.path;
  return (
    <Section title="Getting started">
      <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.SETUP_NOTE}</p>
      <div>
        <PageLink primary to={context?.companyPath(path) ?? path} label={pageTitle('companyRegisterSetup')} />
      </div>
    </Section>
  );
}
