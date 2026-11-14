import { DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { pageTitle } from '@utils/destinations';
import { LinkRow, Section, Status } from '@components/Ledger';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function GettingStarted() {
  const context = useCompanyContext();
  const ledger = DESTINATIONS.companyRegister.path;
  return (
    <Section title="Getting started">
      <LinkRow
        to={context?.companyPath(ledger) ?? ledger}
        label={pageTitle('companyRegisterSetup')}
        aside={<Status tone="waiting">To do</Status>}
      >
        <p className="text-text-muted">{REGISTER_IMPORT_COPY.SETUP_NOTE}</p>
      </LinkRow>
    </Section>
  );
}
