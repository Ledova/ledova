import {
  formatDateTime,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  APPOINTMENT_STATUS_LABELS,
} from '@ledova/shared';
import { Row, Rows, Disclosure } from '@components/Ledger';
import { PageAction } from '@components/Page';
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
    <li className="space-y-4 py-4">
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
              <Row label="Appointment">{appointment.uuid}</Row>
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
        <PageAction label="Revoke appointment" context={appointment.uuid} disabled={disabled} onClick={onRevoke} />
      )}
    </li>
  );
}
