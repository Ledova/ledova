import { Field, TextInput } from '@components/Field';
import { useState, type ReactNode } from 'react';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  failureSentence,
  readApiError,
  formatDateTime,
  formatShortDate,
  getUserVerificationStatus,
  VERIFICATION_TONES,
} from '@ledova/shared';
import { useSettings } from './useSettings';
import { Modal } from '@components/Modal';
import { PageAction, PageLink } from '@components/Page';
import { Outcome, Section, Status, Failure } from '@components/Ledger';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { ErrorSummary } from '@components/ErrorSummary';
import { IdentityVerificationModal } from '@components/IdentityVerificationModal';
import { useUserProfile } from '@hooks/useUserProfile';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { MEMBER_INVITATION_PATH } from '@utils/paths';

function SettingRow({ label, detail, action }: { label?: string; detail?: ReactNode; action: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3">
      <div className="min-w-0 space-y-1 text-sm">
        {label && <p className="break-words font-medium text-text-primary">{label}</p>}
        {detail && <p className="break-words text-text-muted">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function PasswordInput({
  id,
  error,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  id: string;
  error: string | null;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1">
      <Field id={id} error={error} label={label}>
        <TextInput
          type={visible ? 'text' : 'password'}
          maxLength={FIELD_LIMITS.PASSWORD}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
        />
      </Field>
      <button
        type="button"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible(!visible)}
        className="text-sm text-brand-light underline"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function AccountSettings() {
  const profile = useUserProfile();
  const context = useCompanyContext();
  const [verificationOpen, setVerificationOpen] = useState(false);
  const verification = getUserVerificationStatus(profile.userProfile);
  const {
    modal,
    setModal,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordProblems,
    passwordChanged,
    setPasswordChanged,
    passwordMutation,
    closePassword,
    savePassword,
  } = useSettings();
  const passwordChecks = useErrorSummary(passwordProblems);
  const passwordReading = passwordMutation.isError
    ? readApiError(passwordMutation.error, {
        fallback: 'Your password could not be changed. Try again.',
        displayedFields: ['currentPassword', 'newPassword', 'newPasswordConfirm'],
        unanswered: 'Your password could not be changed. Try again.',
      })
    : null;
  const passwordField = (key: keyof typeof passwordProblems) => {
    const check = passwordChecks.field(key);
    return { id: check.id, error: check.error ?? passwordReading?.fieldErrors?.[key]?.join(' ') ?? null };
  };
  return (
    <>
      <Section title="Security">
        <div className="divide-y divide-border-subtle">
          {profile.userProfile && (
            <SettingRow
              label="Identity check"
              action={
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-text-muted">
                  <Status tone={VERIFICATION_TONES.get(verification.type) ?? 'waiting'}>{verification.label}</Status>
                  <PageAction
                    compact
                    label="Review"
                    context="identity check"
                    disabled={profile.isFetching}
                    onClick={() => setVerificationOpen(true)}
                  />
                </div>
              }
            />
          )}
          <SettingRow
            label="Password"
            action={
              <PageAction
                compact
                label="Change"
                context="password"
                onClick={() => {
                  setPasswordChanged(false);
                  setModal('password');
                }}
              />
            }
          />
        </div>
        <Outcome>{passwordChanged && 'Your password was changed.'}</Outcome>
      </Section>
      {profile.userProfile && (
        <Section title="Account details">
          <div className="divide-y divide-border-subtle">
            <SettingRow
              label="Member since"
              action={
                <span className="text-sm text-text-muted">
                  {formatShortDate(profile.userProfile.dateJoined, 'Not available')}
                </span>
              }
            />
            <SettingRow
              label="Last login"
              action={<span className="text-sm text-text-muted">{formatDateTime(profile.userProfile.lastLogin)}</span>}
            />
          </div>
        </Section>
      )}
      <Section title="Invitations">
        <div className="divide-y divide-border-subtle">
          <SettingRow
            label="Shareholder invitation"
            detail="Use the link or code from your company’s email."
            action={<PageLink compact to={MEMBER_INVITATION_PATH} label="Accept" context="shareholder invitation" />}
          />
          {!context?.company?.canManage && (
            <SettingRow
              label="Company officer invitation"
              detail="Use the code the company gave you."
              action={
                <PageLink
                  compact
                  to={context?.companyPath(DESTINATIONS.companyTeam.path) ?? DESTINATIONS.companyTeam.path}
                  label="Accept"
                  context="company officer invitation"
                />
              }
            />
          )}
        </div>
      </Section>
      {verificationOpen && profile.userProfile && (
        <IdentityVerificationModal
          isOpen={verificationOpen}
          onClose={() => {
            setVerificationOpen(false);
            profile.refreshProfile();
          }}
        />
      )}
      <Modal
        isOpen={modal === 'password'}
        onClose={() => {
          passwordChecks.reset();
          closePassword();
        }}
        title="Change password"
        showFooter
        confirmLabel="Change password"
        formId="change-password"
        busy={passwordMutation.isPending}
        busyLabel="Changing password…"
      >
        {modal === 'password' && (
          <form
            id="change-password"
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (passwordChecks.check()) savePassword();
            }}
          >
            <ErrorSummary {...passwordChecks.summary} />
            <PasswordInput
              {...passwordField('currentPassword')}
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              disabled={passwordMutation.isPending}
            />
            <PasswordInput
              {...passwordField('newPassword')}
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              disabled={passwordMutation.isPending}
            />
            <PasswordInput
              {...passwordField('newPasswordConfirm')}
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={passwordMutation.isPending}
            />
            {passwordReading && (
              <Failure>
                {passwordReading.generalError ?? 'The password was not changed. Check the fields above.'}
              </Failure>
            )}
          </form>
        )}
      </Modal>
    </>
  );
}

export function AccountData() {
  const { modal, setModal, deleteMutation, exportMutation } = useSettings();
  return (
    <>
      <Section title="Your data">
        <div className="divide-y divide-border-subtle">
          <SettingRow
            label="Export data"
            detail="Download a copy of your account data."
            action={
              <PageAction
                compact
                label="Export"
                context="account data"
                onClick={() => {
                  exportMutation.reset();
                  setModal('export');
                }}
              />
            }
          />
          <SettingRow
            label="Delete account"
            detail="Deactivates your account and removes personal details. Some records are retained."
            action={
              <PageAction
                compact
                label="Delete"
                context="account"
                onClick={() => {
                  deleteMutation.reset();
                  setModal('delete');
                }}
              />
            }
          />
        </div>
      </Section>
      <Modal
        isOpen={modal === 'export'}
        onClose={() => setModal(null)}
        title="Export data"
        showFooter
        confirmLabel="Export"
        onConfirm={() => exportMutation.mutate()}
        busy={exportMutation.isPending}
        busyLabel="Exporting…"
      >
        <p className="text-sm text-text-muted">
          Download your account data as a JSON file. The download starts when the export is ready.
        </p>
        {exportMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-error-light">
            {failureSentence(exportMutation.error, 'Your data could not be exported. Try again.')}
          </p>
        )}
      </Modal>
      <Modal
        isOpen={modal === 'delete'}
        onClose={() => setModal(null)}
        title="Delete account"
        showFooter
        confirmLabel="Delete account"
        destructive
        onConfirm={() => deleteMutation.mutate()}
        busy={deleteMutation.isPending}
        busyLabel="Deleting account…"
      >
        <p className="mb-3 text-sm font-medium">This action cannot be undone.</p>
        <p className="text-sm text-text-muted">
          This deactivates your account and removes your name, date of birth, phone number and address from your
          profile. Your country of citizenship, financial profile, wallets, verification records and share register
          entries are kept.
        </p>
        {deleteMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-error-light">
            {failureSentence(
              deleteMutation.error,
              'Your account could not be deleted. Try again or contact the deployment operator.',
            )}
          </p>
        )}
      </Modal>
    </>
  );
}
