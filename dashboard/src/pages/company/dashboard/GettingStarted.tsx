import { DESTINATIONS } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { ActivationStep, SetupStep } from '@components/SetupStep';

export function GettingStarted({ activated, registered }: { activated: boolean; registered: boolean }) {
  return (
    <Section title="Getting started">
      <div className="divide-y divide-border-subtle">
        <ActivationStep done={activated} />
        <SetupStep
          to={DESTINATIONS.companyRegister.path}
          label="Set up your share register"
          note="Bring in the company's existing share records. This doesn't wait for activation."
          done={registered}
        />
      </div>
    </Section>
  );
}
