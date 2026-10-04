import { useRef, useState } from 'react';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  formatDateTime,
  type CompanyAuthorityRequest,
  type CompanyCapability,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { Row, Rows, Status } from '@components/Ledger';
import { Modal } from '@components/Modal';

function scopeLabels(values: CompanyCapability[]) {
  return (
    values
      .map((value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value)
      .join(', ') || 'None'
  );
}

export function AuthorityRequestRecord({
  request,
  blocked,
  opening,
  action,
  onDownload,
  onWithdraw,
  onAdmit,
  onRevoke,
}: {
  request: CompanyAuthorityRequest;
  blocked: boolean;
  opening: boolean;
  action?: 'withdraw' | 'admit' | 'revoke';
  onDownload: () => void;
  onWithdraw: () => void;
  onAdmit: () => void;
  onRevoke: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [confirmingRevocation, setConfirmingRevocation] = useState<symbol | null>(null);
  const revocationConfirmation = useRef<symbol | null>(null);
  const appointment = request.appointment;
  const closeRevocationConfirmation = () => {
    revocationConfirmation.current = null;
    setConfirmingRevocation(null);
  };
  return (
    <li className="space-y-2 py-3">
      <Rows>
        <Row label="Request">{request.uuid}</Row>
        <Row label="Company information (provided by the company)">
          {request.companyIdentityRaw.name} · {request.companyIdentityRaw.acn}
        </Row>
        <Row label="Status">
          <Status tone={request.status === 'pending' ? 'waiting' : 'closed'}>
            {request.status === 'withdrawn' ? 'Withdrawn' : request.status === 'admitted' ? 'Admitted' : 'Pending'}
          </Status>
        </Row>
        <Row label="Submitted">{formatDateTime(request.createdAt)}</Row>
        {request.withdrawnAt && <Row label="Withdrawn">{formatDateTime(request.withdrawnAt)}</Row>}
        <Row label="Requested expiry">
          {request.requestedExpiresAt ? formatDateTime(request.requestedExpiresAt) : 'No requested expiry'}
        </Row>
        <Row label="Requested actions">{scopeLabels(request.requestedCapabilities)}</Row>
        <Row label="Requested delegation">{scopeLabels(request.delegatableCapabilities)}</Row>
      </Rows>
      <p className="text-sm text-text-muted">{request.verificationMessage}</p>
      <PageAction
        label={`Download evidence ${request.originalFilename}`}
        disabled={opening || blocked}
        onClick={onDownload}
      />
      {request.status === 'pending' && (
        <>
          {request.requestedCapabilities.includes('admin') ? (
            <div className="space-y-2">
              <p className="text-sm text-text-primary">{COMPANY_AUTHORITY_DECLARATION}</p>
              <p className="text-sm text-text-muted">
                Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Your appointment uses the exact
                permissions, delegation and expiry of this request. It does not activate the company or approve any
                register action.
              </p>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={blocked}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                Accept authorisation declaration for {request.companyIdentityRaw.name}
              </label>
              <PageAction
                label={`${action === 'admit' ? 'Admitting' : 'Establish'} appointment ${request.originalFilename}`}
                disabled={blocked || !accepted}
                onClick={onAdmit}
              />
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              Initial admission requires Manage company information and team in your own requested actions. Submit a new
              request with that permission to establish your appointment.
            </p>
          )}
          <p className="text-sm text-text-muted">Withdrawing retires this request and retains its evidence.</p>
          <PageAction
            label={`${action === 'withdraw' ? 'Withdrawing' : 'Withdraw'} request ${request.originalFilename}`}
            disabled={blocked}
            onClick={onWithdraw}
          />
        </>
      )}
      {appointment && (
        <>
          <Rows>
            <Row label="Appointment">{appointment.uuid}</Row>
            <Row label="Appointment status">{appointment.status}</Row>
            <Row label="Current company authority">{appointment.isEffective ? 'Current' : 'Not current'}</Row>
            <Row label="Admitted">{formatDateTime(appointment.createdAt)}</Row>
            <Row label="Appointed actions">{scopeLabels(appointment.capabilities)}</Row>
            <Row label="Appointed delegation">{scopeLabels(appointment.delegatableCapabilities)}</Row>
            <Row label="Appointment expiry">
              {appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'No expiry'}
            </Row>
            {appointment.revokedAt && <Row label="Revoked">{formatDateTime(appointment.revokedAt)}</Row>}
            <Row label="Declaration version">{appointment.declarationVersion}</Row>
          </Rows>
          <p className="text-sm text-text-primary">{appointment.declarationText}</p>
          <p className="text-sm text-text-muted">
            This is your recorded self-declaration. Company information is provided by the company. An appointment does
            not activate the company or approve any register action.
          </p>
          <p className="text-sm text-text-muted">
            Revocation permanently removes this appointment&apos;s company authority. You cannot restore it by making
            another initial self-declaration. Its declaration and evidence remain retained.
          </p>
          {appointment.status !== 'revoked' && (
            <PageAction
              label={`${action === 'revoke' ? 'Revoking' : 'Revoke'} appointment ${request.originalFilename}`}
              disabled={blocked}
              onClick={() => {
                if (blocked || revocationConfirmation.current) return;
                const confirmation = Symbol();
                revocationConfirmation.current = confirmation;
                setConfirmingRevocation(confirmation);
              }}
            />
          )}
          <Modal
            isOpen={!!confirmingRevocation}
            onClose={closeRevocationConfirmation}
            title="Revoke appointment permanently?"
            showFooter
            confirmLabel="Permanently revoke appointment"
            confirmDisabled={!confirmingRevocation || blocked || appointment.status === 'revoked'}
            onConfirm={() => {
              if (
                !confirmingRevocation ||
                revocationConfirmation.current !== confirmingRevocation ||
                blocked ||
                appointment.status === 'revoked'
              )
                return;
              closeRevocationConfirmation();
              onRevoke();
            }}
          >
            <p className="text-sm text-text-primary">
              Permanently remove your appointment for {request.companyIdentityRaw.name}? You will lose this
              appointment&apos;s company authority and cannot restore it by making another initial self-declaration. Its
              declaration and evidence remain retained.
            </p>
          </Modal>
        </>
      )}
    </li>
  );
}
