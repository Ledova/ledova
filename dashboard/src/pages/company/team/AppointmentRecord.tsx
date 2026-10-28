import { useId, useState } from 'react';
import {
  formatDate,
  formatDateTime,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  APPOINTMENT_STATUS_LABELS,
} from '@ledova/shared';
import { MoreToggle } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { currentAppointment, scopeLabels } from '@pages/company/shared/appointments';

const SOURCES = {
  initial: 'Initial self-declaration',
  legacy_owner: 'Legacy company owner',
} as const;

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
  const source = SOURCES[appointment.source as keyof typeof SOURCES] ?? 'Company invitation';
  return (
    <li className="grid min-w-0 gap-x-4 gap-y-2 py-4 text-sm md:grid-cols-[minmax(0,1fr)_14rem] xl:grid-cols-[minmax(0,1fr)_14rem_12rem]">
      <div className="min-w-0 space-y-1 break-words">
        <p className="font-medium text-text-primary">{title}</p>
        {person?.name && <p className="text-text-muted">{person.email}</p>}
        <p className="text-text-muted">{scopeLabels(appointment.capabilities)}</p>
        {appointment.delegatableCapabilities.length > 0 && (
          <p className="text-text-muted">May delegate: {scopeLabels(appointment.delegatableCapabilities)}</p>
        )}
      </div>
      <div className="min-w-0 space-y-1 break-words text-text-muted">
        <p>
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
          {appointment.status === 'active' && !currentAppointment(appointment) && ' · not current'}
        </p>
        <p>
          {appointment.revokedAt
            ? `Revoked ${formatDateTime(appointment.revokedAt)}`
            : appointment.expiresAt
              ? `Expires ${formatDateTime(appointment.expiresAt)}`
              : 'No expiry'}
        </p>
        <p>
          {source} · <span className="whitespace-nowrap">{formatDate(appointment.createdAt)}</span>
        </p>
      </div>
      {appointment.status !== 'revoked' && (
        <div className="flex items-start justify-end md:col-span-2 xl:col-span-1">
          <PageAction
            label="Revoke appointment"
            context={`${title} · ${scopeLabels(appointment.capabilities)}`}
            disabled={disabled}
            onClick={onRevoke}
          />
        </div>
      )}
      {declaration && (
        <div className="space-y-2 md:col-span-2 xl:col-span-3">
          <MoreToggle
            open={declarationShown}
            controls={declarationId}
            onToggle={() => setDeclarationShown((value) => !value)}
          >
            {declarationShown ? 'Hide the declaration' : 'Show the declaration'}
          </MoreToggle>
          <p id={declarationId} hidden={!declarationShown} className="text-text-muted">
            {declaration}
          </p>
        </div>
      )}
    </li>
  );
}
