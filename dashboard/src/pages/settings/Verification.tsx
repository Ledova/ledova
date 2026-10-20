import {
  DESTINATIONS,
  IDENTITY_CHECK_COPY,
  companiesAwaitingActivation,
  getUserVerificationStatus,
} from '@ledova/shared';
import { LinkRow, Section, Status } from '@components/Ledger';
import { ActivationStep } from '@components/SetupStep';
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
    <Section title={administers ? 'Verification and activation' : 'Identity'}>
      <div className="divide-y divide-border-subtle">
        {administers && <ActivationStep done={companiesAwaitingActivation(own).length === 0} />}
        <LinkRow
          to={DESTINATIONS.userProfile.path}
          label={IDENTITY_CHECK_COPY.STEP}
          aside={
            userProfile && <Status tone={VERIFICATION_TONES.get(identity.type) ?? 'waiting'}>{identity.label}</Status>
          }
        >
          <p className="text-text-muted">{IDENTITY_CHECK_COPY.NOTE}</p>
        </LinkRow>
      </div>
    </Section>
  );
}
