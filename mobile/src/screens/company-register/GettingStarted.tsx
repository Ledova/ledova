import { REGISTER_IMPORT_COPY } from '@ledova/shared';
import { Rows, Section } from '../../components/Ledger';
import { ActivationStep, SetupStep } from '../../components/SetupStep';

export function GettingStarted({
  activated,
  registered,
  onSetUp,
}: {
  activated: boolean;
  registered: boolean;
  onSetUp: () => void;
}) {
  return (
    <Section title="Getting started">
      <Rows>
        <ActivationStep done={activated} />
        <SetupStep
          label={REGISTER_IMPORT_COPY.SETUP}
          note={REGISTER_IMPORT_COPY.SETUP_NOTE}
          done={registered}
          onPress={onSetUp}
        />
      </Rows>
    </Section>
  );
}
