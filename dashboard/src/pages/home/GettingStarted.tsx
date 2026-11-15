import { DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { pageTitle } from '@utils/destinations';
import { Section } from '@components/Ledger';
import { PageLink } from '@components/Page';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function GettingStarted({ hasClass }: { hasClass: boolean }) {
  const context = useCompanyContext();
  const path = hasClass ? DESTINATIONS.companyRegister.path : DESTINATIONS.companyRegisterSetup.path;
  return (
    <Section title="Getting started">
      <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.SETUP_NOTE}</p>
      <div>
        <PageLink primary to={context?.companyPath(path) ?? path} label={pageTitle('companyRegisterSetup')} />
      </div>
    </Section>
  );
}
