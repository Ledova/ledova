import {
  DESTINATIONS,
  GETTING_STARTED_COPY,
  companiesAwaitingActivation,
  getUserVerificationStatus,
} from '@ledova/shared';
import { LinkRow, Section, Status } from '@components/Ledger';
import { SetupStep } from '@components/SetupStep';
import { VERIFICATION_TONES } from '@components/statusTones';
import { useSignedInAppointments } from '@hooks/useOwnAppointments';
import { useUserProfile } from '@hooks/useUserProfile';

export function Verification() {
  const { userProfile } = useUserProfile();
  const appointments = useSignedInAppointments();
  const own = appointments.data ?? [];
  const administers = own.some((appointment) => appointment.isEffective && appointment.capabilities.includes('admin'));
  const identity = getUserVerificationStatus(userProfile);
  return (
    <Section title={administers ? 'Verification and activation' : 'Verification'}>
      <div className="divide-y divide-border-subtle">
        {administers && (
          <SetupStep
            to={DESTINATIONS.companyListing.path}
            label={GETTING_STARTED_COPY.ACTIVATE}
            note={GETTING_STARTED_COPY.ACTIVATE_NOTE}
            done={companiesAwaitingActivation(own).length === 0}
          />
        )}
        <LinkRow
          to={DESTINATIONS.userProfile.path}
          label="Verify your identity"
          aside={
            userProfile && <Status tone={VERIFICATION_TONES.get(identity.type) ?? 'waiting'}>{identity.label}</Status>
          }
        >
          <p className="text-text-muted">Your identity check, used where activation or eligibility requires it.</p>
        </LinkRow>
      </div>
    </Section>
  );
}
