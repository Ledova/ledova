import { COMPANY_ACTIVATION_COPY, DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { pageTitle } from '@utils/destinations';
import { Section } from '@components/Ledger';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { SetupStep } from '@components/SetupStep';

export function GettingStarted({ activated, registered }: { activated: boolean; registered: boolean }) {
  const context = useCompanyContext();
  const path = (to: string) => context?.companyPath(to) ?? to;
  return (
    <Section title="Getting started">
      <div className="divide-y divide-border-subtle">
        {!activated && (
          <SetupStep
            to={path(DESTINATIONS.companyListing.path)}
            label={COMPANY_ACTIVATION_COPY.STEP}
            note={COMPANY_ACTIVATION_COPY.CHECKS}
            done={false}
          />
        )}
        {!registered && (
          <SetupStep
            to={path(DESTINATIONS.companyRegister.path)}
            label={pageTitle('companyRegisterSetup')}
            note={REGISTER_IMPORT_COPY.SETUP_NOTE}
            done={false}
          />
        )}
      </div>
    </Section>
  );
}
