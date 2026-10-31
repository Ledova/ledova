import { Field, TextInput } from '@components/Field';
import { useState } from 'react';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  failureSentence,
  readApiError,
  formatDate,
  formatDateTime,
  getUserVerificationStatus,
  VERIFICATION_TONES,
} from '@ledova/shared';
import { useSettings } from './useSettings';
import { Modal } from '@components/Modal';
import { PageAction, PageLink } from '@components/Page';
import { Outcome, Row, Rows, Section, Status, SwitchRow, Failure } from '@components/Ledger';
import { setTheme } from '@hooks/useTheme';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { ErrorSummary } from '@components/ErrorSummary';
import { IdentityVerificationModal } from '@components/IdentityVerificationModal';
import type { useUserProfile } from '@hooks/useUserProfile';
import { useCompanyContext } from '@hooks/useCompanyContext';

function ActionRow({ description, label, onClick }: { description: string; label: string; onClick: () => void }) {
  return (
    <div className="grid items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <p className="min-w-0 text-sm text-text-muted">{description}</p>
      <PageAction label={label} onClick={onClick} />
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

export function AccountSettings({ profile }: { profile: ReturnType<typeof useUserProfile> }) {
  const context = useCompanyContext();
  const [verificationOpen, setVerificationOpen] = useState(false);
  const verification = getUserVerificationStatus(profile.userProfile);
  const {
    theme,
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
    deleteMutation,
    passwordMutation,
    exportMutation,
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
      <Section title="Account">
        <div className="divide-y divide-border-subtle">
          {profile.userProfile && (
            <div className="grid items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <p className="text-sm text-text-muted">
                Identity check{' '}
                <Status tone={VERIFICATION_TONES.get(verification.type) ?? 'waiting'}>{verification.label}</Status>
              </p>
              <PageAction
                label="Review identity check"
                disabled={profile.isFetching}
                onClick={() => setVerificationOpen(true)}
              />
            </div>
          )}
          <ActionRow
            description="Choose a new password for your account."
            label="Change password"
            onClick={() => {
              setPasswordChanged(false);
              setModal('password');
            }}
          />
          <Outcome>{passwordChanged && 'Your password was changed.'}</Outcome>
          <SwitchRow
            label="Dark theme"
            description="Saved in this browser."
            checked={theme === 'dark'}
            onChange={(dark) => setTheme(dark ? 'dark' : 'paper')}
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <h3 className="text-sm font-medium text-text-primary">Manage account</h3>
          {profile.userProfile && (
            <Rows>
              <Row label="Member since">{formatDate(profile.userProfile.dateJoined, 'Not available')}</Row>
              <Row label="Last login">{formatDateTime(profile.userProfile.lastLogin)}</Row>
            </Rows>
          )}
          <div className="divide-y divide-border-subtle">
            {!context?.company?.canManage && (
              <div className="flex justify-end py-3">
                <PageLink
                  to={context?.companyPath(DESTINATIONS.companyTeam.path) ?? DESTINATIONS.companyTeam.path}
                  label="Accept a company invitation"
                />
              </div>
            )}
            <ActionRow
              description="Download a copy of your account data."
              label="Export data"
              onClick={() => {
                exportMutation.reset();
                setModal('export');
              }}
            />
            <ActionRow
              description="Deactivate your account and remove personal details. Some records are retained."
              label="Delete account"
              onClick={() => {
                deleteMutation.reset();
                setModal('delete');
              }}
            />
          </div>
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
          entries are kept, and so are the eligibility requests you sent, with your name as each company received it.
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
