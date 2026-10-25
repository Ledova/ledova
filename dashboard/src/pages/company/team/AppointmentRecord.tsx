import {
  formatDateTime,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  APPOINTMENT_STATUS_LABELS,
  shortReference,
} from '@ledova/shared';
import { Row, Rows, Disclosure } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { currentAppointment, scopeLabels } from '@pages/company/shared/appointments';

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
  return (
    <li className="py-3">
      <Disclosure
        summary={
          <span className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {teamRecord && 'name' in appointment ? appointment.name || appointment.email : companyName}
              </span>
              <span className="block truncate text-text-muted">
                {teamRecord && 'email' in appointment ? appointment.email : scopeLabels(appointment.capabilities)}
              </span>
            </span>
            <span className="text-text-muted">{APPOINTMENT_STATUS_LABELS[appointment.status]}</span>
          </span>
        }
      >
        <Rows>
          <Row label="Company">{companyName}</Row>
          {teamRecord && 'email' in appointment && (
            <>
              <Row label="Name">{appointment.name || 'Not provided'}</Row>
              <Row label="Email">{appointment.email}</Row>
            </>
          )}
          <Row label="Status">{APPOINTMENT_STATUS_LABELS[appointment.status]}</Row>
          <Row label="Current authority">{currentAppointment(appointment) ? 'Current' : 'Not current'}</Row>
          <Row label="Personal actions">{scopeLabels(appointment.capabilities)}</Row>
          <Row label="May delegate">{scopeLabels(appointment.delegatableCapabilities)}</Row>
          <Row label="Expiry">{appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'No expiry'}</Row>
        </Rows>
        <Disclosure summary="Appointment record">
          <div className="text-sm">
            <div className="space-y-3 pt-3">
              <Rows>
                <Row label="Appointment">{shortReference(appointment.uuid)}</Row>
                <Row label="Source">
                  {appointment.source === 'initial'
                    ? 'Initial self-declaration'
                    : appointment.source === 'legacy_owner'
                      ? 'Legacy company owner'
                      : 'Company invitation'}
                </Row>
                <Row label="Created">{formatDateTime(appointment.createdAt)}</Row>
                {appointment.revokedAt && <Row label="Revoked">{formatDateTime(appointment.revokedAt)}</Row>}
              </Rows>
              {!teamRecord && appointment.source !== 'legacy_owner' && 'declarationText' in appointment && (
                <p className="text-text-muted">{appointment.declarationText}</p>
              )}
            </div>
          </div>
        </Disclosure>
        {appointment.status !== 'revoked' && (
          <FormActions>
            <PageAction
              label="Revoke appointment"
              context={shortReference(appointment.uuid)}
              disabled={disabled}
              onClick={onRevoke}
            />
          </FormActions>
        )}
      </Disclosure>
    </li>
  );
}
