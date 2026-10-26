import { Field, TextInput } from '@components/Field';
import { useState } from 'react';
import { FIELD_LIMITS, failureSentence, readApiError } from '@ledova/shared';
import { useSettings } from './useSettings';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import { Outcome, Section, SwitchRow, LoadError, Loading } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { setTheme } from '@hooks/useTheme';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { ErrorSummary } from '@components/ErrorSummary';
import { Navigate, useLocation } from 'react-router-dom';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { CompanyRecordedDetails } from './CompanyRecordedDetails';

export default function SettingsPage() {
  const { hash } = useLocation();
  if (hash === '#company-recorded-details') return <CompanyRecordedDetails />;
  if (hash === '#account') return <Account />;
  return <SettingsLanding />;
}

function SettingsLanding() {
  const navigation = useSettingsNavigation();
  if (navigation.isError)
    return (
      <Page>
        <LoadError retry={() => void navigation.retry()} busy={navigation.isFetching}>
          Your settings could not be loaded.
        </LoadError>
      </Page>
    );
  if (navigation.isLoading) return <Page loading />;
  return <Navigate to={navigation.defaultPath} replace />;
}

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

function Account() {
  const {
    preferences,
    theme,
    transactionAlerts,
    alerts,
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
      })
    : null;
  const passwordField = (key: keyof typeof passwordProblems) => {
    const check = passwordChecks.field(key);
    return { id: check.id, error: check.error ?? passwordReading?.fieldErrors?.[key]?.join(' ') ?? null };
  };
  return (
    <PageTitle.Provider value="Account">
      <Page>
        <Section title="Security">
          <div className="divide-y divide-border-subtle">
            <ActionRow
              description="Choose a new password for your account."
              label="Change password"
              onClick={() => {
                setPasswordChanged(false);
                setModal('password');
              }}
            />
          </div>
          <Outcome>{passwordChanged && 'Your password was changed.'}</Outcome>
        </Section>
        <Section title="Preferences">
          <div className="divide-y divide-border-subtle">
            <SwitchRow
              label="Dark theme"
              description="Saved in this browser."
              checked={theme === 'dark'}
              onChange={(dark) => setTheme(dark ? 'dark' : 'paper')}
            />
            <div>
              {preferences.isError ? (
                <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
                  Notification preferences could not be loaded.
                </LoadError>
              ) : preferences.isLoading ? (
                <Loading>Loading notification preferences…</Loading>
              ) : transactionAlerts === undefined ? (
                <p className="text-sm text-text-muted">Notification preferences are unavailable.</p>
              ) : (
                <SwitchRow
                  label="Transaction alerts"
                  description="Notifications for transaction status changes."
                  checked={transactionAlerts}
                  disabled={alerts.isPending}
                  onChange={(value) => alerts.mutate(value)}
                />
              )}
              {alerts.isError && (
                <p role="alert" className="text-sm text-error-light">
                  Your notification preference could not be saved. Try again.
                </p>
              )}
            </div>
          </div>
        </Section>
        <Section title="Data and privacy">
          <div className="divide-y divide-border-subtle">
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
        </Section>
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
                <p role="alert" className="text-sm text-error-light">
                  {passwordReading.generalError ?? 'The password was not changed. Check the fields above.'}
                </p>
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
            This deactivates your account and removes your name, date of birth, phone number and address. Your country
            of citizenship, financial profile, wallets, verification records and share register entries are kept.
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
      </Page>
    </PageTitle.Provider>
  );
}
