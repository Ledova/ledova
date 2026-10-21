import { AUTHORITY_REQUEST_TONES } from '@pages/company/shared/statusTones';
import { SITE_PATHS } from '@utils/paths';
import { useRef, useState } from 'react';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
  formatDateTime,
  type CompanyAuthorityRequest,
  type CompanyCapability,
  APPOINTMENT_STATUS_LABELS,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { CheckboxField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { Row, Rows, Status, Disclosure } from '@components/Ledger';
import { Confirmation, Modal } from '@components/Modal';
import { SITE_URL } from '@utils/siteUrl';

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
  downloading,
  action,
  onDownload,
  onWithdraw,
  onAdmit,
  onRevoke,
}: {
  request: CompanyAuthorityRequest;
  blocked: boolean;
  opening: boolean;
  downloading: boolean;
  action?: 'withdraw' | 'admit' | 'revoke';
  onDownload: () => void;
  onWithdraw: () => Promise<unknown>;
  onAdmit: () => void;
  onRevoke: () => Promise<unknown>;
}) {
  const [accepted, setAccepted] = useState(false);
  const acceptance = useErrorSummary({ accepted: !accepted && 'Accept the authority declaration and Terms.' });
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);
  const [confirmingRevocation, setConfirmingRevocation] = useState<symbol | null>(null);
  const revocationConfirmation = useRef<symbol | null>(null);
  const appointment = request.appointment;
  const closeRevocationConfirmation = () => {
    revocationConfirmation.current = null;
    setConfirmingRevocation(null);
  };
  return (
    <li className="space-y-4 py-4">
      <Rows>
        <Row label="Company information (provided by the company)">
          {request.companyIdentityRaw.name} · {request.companyIdentityRaw.acn}
        </Row>
        <Row label="Status">
          <Status tone={AUTHORITY_REQUEST_TONES.get(request.status) ?? 'closed'}>
            {request.status === 'withdrawn' ? 'Withdrawn' : request.status === 'admitted' ? 'Admitted' : 'Pending'}
          </Status>
        </Row>
        <Row label="Requested expiry">
          {request.requestedExpiresAt ? formatDateTime(request.requestedExpiresAt) : 'No requested expiry'}
        </Row>
        <Row label="Requested actions">{scopeLabels(request.requestedCapabilities)}</Row>
        <Row label="Requested delegation">{scopeLabels(request.delegatableCapabilities)}</Row>
      </Rows>
      <Disclosure summary="Request record">
        <div className="text-sm">
          <Rows>
            <Row label="Request">{request.uuid}</Row>
            <Row label="Submitted">{formatDateTime(request.createdAt)}</Row>
            {request.withdrawnAt && <Row label="Withdrawn">{formatDateTime(request.withdrawnAt)}</Row>}
          </Rows>
        </div>
      </Disclosure>
      <p className="text-sm text-text-muted">{request.verificationMessage}</p>
      {request.fileUrl && (
        <PageAction
          label={`Download evidence ${request.originalFilename || request.companyIdentityRaw.name}`}
          disabled={opening || blocked}
          busy={downloading}
          busyLabel="Downloading…"
          onClick={onDownload}
        />
      )}
      {request.status === 'pending' && (
        <>
          {request.requestedCapabilities.includes('admin') ? (
            <div className="space-y-2">
              <ErrorSummary {...acceptance.summary} />
              <p className="text-sm text-text-primary">{COMPANY_SIGNUP_DECLARATION}</p>
              <p className="text-sm text-text-muted">
                Declaration version {COMPANY_SIGNUP_DECLARATION_VERSION}. Your appointment uses the exact permissions,
                delegation and expiry of this request. It does not activate the company or approve any register action.
              </p>
              <a
                href={`${SITE_URL}${SITE_PATHS.termsOfService}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-light underline"
              >
                Terms of Service
              </a>
              <CheckboxField
                {...acceptance.field('accepted')}
                label={`Accept authority declaration and Terms for ${request.companyIdentityRaw.name}`}
                checked={accepted}
                disabled={blocked}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <PageAction
                label={`Establish appointment ${request.originalFilename || request.companyIdentityRaw.name}`}
                busy={action === 'admit'}
                busyLabel="Establishing appointment…"
                primary
                disabled={blocked}
                onClick={() => {
                  if (acceptance.check()) onAdmit();
                }}
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
            label={`Withdraw request ${request.originalFilename || request.companyIdentityRaw.name}`}
            disabled={blocked}
            onClick={() => setConfirmingWithdrawal(true)}
          />
          {confirmingWithdrawal && (
            <Confirmation
              isOpen
              title="Withdraw this authority request?"
              confirmLabel="Withdraw request"
              confirmDisabled={blocked}
              busy={action === 'withdraw'}
              busyLabel="Withdrawing…"
              onClose={() => setConfirmingWithdrawal(false)}
              onConfirm={() =>
                void onWithdraw()
                  .catch(() => undefined)
                  .finally(() => setConfirmingWithdrawal(false))
              }
            >
              Your request for {request.companyIdentityRaw.name} is retired and can&apos;t be admitted. Its evidence is
              retained.
            </Confirmation>
          )}
        </>
      )}
      {appointment && (
        <>
          <Rows>
            <Row label="Appointment status">{APPOINTMENT_STATUS_LABELS[appointment.status]}</Row>
            <Row label="Current company authority">{appointment.isEffective ? 'Current' : 'Not current'}</Row>
            <Row label="Admitted">{formatDateTime(appointment.createdAt)}</Row>
            <Row label="Appointed actions">{scopeLabels(appointment.capabilities)}</Row>
            <Row label="Appointed delegation">{scopeLabels(appointment.delegatableCapabilities)}</Row>
            <Row label="Appointment expiry">
              {appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'No expiry'}
            </Row>
            {appointment.revokedAt && <Row label="Revoked">{formatDateTime(appointment.revokedAt)}</Row>}
          </Rows>
          <Disclosure summary="Appointment and declaration record">
            <div className="text-sm">
              <div className="space-y-3 pt-3">
                <Rows>
                  <Row label="Appointment">{appointment.uuid}</Row>
                  <Row label="Declaration version">{appointment.declarationVersion}</Row>
                </Rows>
                <p className="text-text-primary">{appointment.declarationText}</p>
                <p className="text-text-muted">
                  This is your recorded self-declaration. Company information is provided by the company. An appointment
                  does not activate the company or approve any register action.
                </p>
              </div>
            </div>
          </Disclosure>
          <p className="text-sm text-text-muted">
            Revocation permanently removes this appointment&apos;s company authority. You cannot restore it by making
            another initial self-declaration. Its declaration and evidence remain retained.
          </p>
          {appointment.status !== 'revoked' && (
            <PageAction
              label={`Revoke appointment ${request.originalFilename || request.companyIdentityRaw.name}`}
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
            destructive
            busy={action === 'revoke'}
            busyLabel="Revoking…"
            confirmDisabled={!confirmingRevocation || blocked || appointment.status === 'revoked'}
            onConfirm={() => {
              if (
                !confirmingRevocation ||
                revocationConfirmation.current !== confirmingRevocation ||
                blocked ||
                appointment.status === 'revoked'
              )
                return;
              void onRevoke()
                .catch(() => undefined)
                .finally(closeRevocationConfirmation);
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
