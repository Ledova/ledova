import { formatDateTime, type CompanyTeamAppointment, type OwnCompanyAppointment } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { currentAppointment, scopeLabels } from './appointments';

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
    <li className="space-y-2 py-3">
      <Rows>
        <Row label="Company (provided by the company)">{companyName}</Row>
        <Row label="Appointment">{appointment.uuid}</Row>
        {teamRecord && 'email' in appointment && (
          <>
            <Row label="Name">{appointment.name || 'Not provided'}</Row>
            <Row label="Email">{appointment.email}</Row>
          </>
        )}
        <Row label="Source">
          {appointment.source === 'initial'
            ? 'Initial self-declaration'
            : appointment.source === 'legacy_owner'
              ? 'Legacy company owner'
              : 'Company invitation'}
        </Row>
        <Row label="Status">{appointment.status}</Row>
        <Row label="Current authority">{currentAppointment(appointment) ? 'Current' : 'Not current'}</Row>
        <Row label="Personal actions">{scopeLabels(appointment.capabilities)}</Row>
        <Row label="May delegate">{scopeLabels(appointment.delegatableCapabilities)}</Row>
        <Row label="Created">{formatDateTime(appointment.createdAt)}</Row>
        <Row label="Expiry">{appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'No expiry'}</Row>
        {appointment.revokedAt && <Row label="Revoked">{formatDateTime(appointment.revokedAt)}</Row>}
      </Rows>
      {!teamRecord && appointment.source !== 'legacy_owner' && 'declarationText' in appointment && (
        <p className="text-sm text-text-muted">{appointment.declarationText}</p>
      )}
      {appointment.status !== 'revoked' && (
        <PageAction label={`Revoke appointment ${appointment.uuid}`} disabled={disabled} onClick={onRevoke} />
      )}
    </li>
  );
}
