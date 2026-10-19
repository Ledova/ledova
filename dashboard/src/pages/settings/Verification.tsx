import {
  DESTINATIONS,
  GETTING_STARTED_COPY,
  OWN_APPOINTMENTS_QUERY_KEY,
  companiesAwaitingActivation,
  getUserVerificationStatus,
  useSubmissionOwner,
} from '@ledova/shared';
import { LinkRow, Section, Status } from '@components/Ledger';
import { VERIFICATION_TONES } from '@components/statusTones';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { useUserProfile } from '@hooks/useUserProfile';
import { Step } from '@pages/company/dashboard/GettingStarted';

export function Verification() {
  const { owner, boundary } = useSubmissionOwner();
  const { userProfile } = useUserProfile();
  const guard = () => {
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
  };
  const appointments = useOwnAppointments(owner!, guard, {
    queryKey: owner ? ownAppointmentsKey(owner) : [...OWN_APPOINTMENTS_QUERY_KEY, null],
    enabled: !!owner,
  });
  const own = appointments.data ?? [];
  const administers = own.some((appointment) => appointment.isEffective && appointment.capabilities.includes('admin'));
  const identity = getUserVerificationStatus(userProfile);
  return (
    <Section title={administers ? 'Verification and activation' : 'Verification'}>
      <div className="divide-y divide-border-subtle">
        {administers && (
          <Step
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
