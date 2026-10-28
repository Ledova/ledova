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

const SOURCES: Record<(OwnCompanyAppointment | CompanyTeamAppointment)['source'], string> = {
  initial: 'Initial self-declaration',
  invitation: 'Company invitation',
  legacy_owner: 'Legacy company owner',
};

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
          {appointment.revokedAt ? (
            <>
              Revoked <span className="whitespace-nowrap">{formatDateTime(appointment.revokedAt)}</span>
            </>
          ) : (
            <>
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
              {appointment.status === 'active' && !currentAppointment(appointment) && ' · not current'}
            </>
          )}
        </p>
        <p>
          {appointment.expiresAt ? (
            <>
              {appointment.status === 'expired' ? 'Expired' : appointment.status === 'active' ? 'Expires' : 'Expiry'}{' '}
              <span className="whitespace-nowrap">{formatDateTime(appointment.expiresAt)}</span>
            </>
          ) : (
            'No expiry'
          )}
        </p>
        <p>
          {SOURCES[appointment.source]} ·{' '}
          <span className="whitespace-nowrap">{formatDateTime(appointment.createdAt)}</span>
        </p>
      </div>
      {appointment.status !== 'revoked' && (
        <div className="flex items-start justify-end md:col-span-2 xl:col-span-1">
          <PageAction
            label="Revoke appointment"
            context={`${title} · ${scopeLabels(appointment.capabilities)} · appointed ${formatDate(appointment.createdAt)}`}
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
            <span className="sr-only"> for {title}</span>
          </MoreToggle>
          <p id={declarationId} hidden={!declarationShown} className="text-text-muted">
            {declaration}
          </p>
        </div>
      )}
    </li>
  );
}
