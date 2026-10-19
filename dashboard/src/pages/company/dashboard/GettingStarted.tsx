import { DESTINATIONS, GETTING_STARTED_COPY } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { SetupStep } from '@components/SetupStep';

export function GettingStarted({ activated, registered }: { activated: boolean; registered: boolean }) {
  return (
    <Section title={GETTING_STARTED_COPY.TITLE}>
      <div className="divide-y divide-border-subtle">
        <SetupStep
          to={DESTINATIONS.companyListing.path}
          label={GETTING_STARTED_COPY.ACTIVATE}
          note={GETTING_STARTED_COPY.ACTIVATE_NOTE}
          done={activated}
        />
        <SetupStep
          to={DESTINATIONS.companyRegister.path}
          label={GETTING_STARTED_COPY.REGISTER}
          note={GETTING_STARTED_COPY.REGISTER_NOTE}
          done={registered}
        />
      </div>
    </Section>
  );
}
