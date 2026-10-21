import { DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { pageTitle } from '@utils/destinations';
import { Section } from '@components/Ledger';
import { ActivationStep, SetupStep } from '@components/SetupStep';

export function GettingStarted({ activated, registered }: { activated: boolean; registered: boolean }) {
  return (
    <Section title="Getting started">
      <div className="divide-y divide-border-subtle">
        {!activated && <ActivationStep done={false} />}
        {!registered && (
          <SetupStep
            to={DESTINATIONS.companyRegister.path}
            label={pageTitle('companyRegisterSetup')}
            note={REGISTER_IMPORT_COPY.SETUP_NOTE}
            done={false}
          />
        )}
      </div>
    </Section>
  );
}
