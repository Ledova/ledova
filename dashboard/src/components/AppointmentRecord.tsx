import { useId, useState } from 'react';
import {
  formatDate,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  appointmentDates,
  appointmentStatus,
  scopeFacts,
  scopeLabels,
} from '@ledova/shared';
import { MoreToggle } from '@components/Ledger';
import { PageAction } from '@components/Page';

export function AppointmentRecord({
  appointment,
  companyName,
  disabled,
  onRevoke,
  teamRecord = false,
}: {
  appointment: OwnCompanyAppointment | CompanyTeamAppointment;
  companyName: string;
  disabled: boolean;
  onRevoke: () => void;
  teamRecord?: boolean;
}) {
  const declarationId = useId();
  const [declarationShown, setDeclarationShown] = useState(false);
  const person = teamRecord && 'email' in appointment ? appointment : null;
  const title = person ? person.name || person.email : companyName;
  const declaration =
    !teamRecord && appointment.source !== 'legacy_owner' && 'declarationText' in appointment
      ? appointment.declarationText
      : '';
  const revocable = appointment.status !== 'revoked';
  return (
    <li className="flex min-w-0 flex-col gap-1 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 break-words font-medium text-text-primary">{title}</p>
        <p className="shrink-0 text-text-muted">{appointmentStatus(appointment)}</p>
      </div>
      <p className="break-words text-xs text-text-muted">
        {[person?.name && person.email, scopeFacts(appointment.capabilities, appointment.delegatableCapabilities)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="break-words text-xs text-text-muted">{appointmentDates(appointment)}</p>
      {(declaration || revocable) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {declaration && (
            <MoreToggle
              open={declarationShown}
              controls={declarationId}
              onToggle={() => setDeclarationShown((value) => !value)}
            >
              {declarationShown ? 'Hide the declaration' : 'Show the declaration'}
              <span className="sr-only"> for {title}</span>
            </MoreToggle>
          )}
          {revocable && (
            <div className="ml-auto">
              <PageAction
                compact
                label="Revoke appointment"
                context={`${title} · ${scopeLabels(appointment.capabilities)} · appointed ${formatDate(appointment.createdAt)}`}
                disabled={disabled}
                onClick={onRevoke}
              />
            </div>
          )}
        </div>
      )}
      {declaration && (
        <p id={declarationId} hidden={!declarationShown} className="text-text-muted">
          {declaration}
        </p>
      )}
    </li>
  );
}
