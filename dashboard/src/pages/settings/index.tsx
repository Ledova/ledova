import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AUTH_QUERY_KEY,
  DESTINATIONS,
  USER_PREFERENCES_QUERY_KEY,
  deleteAccount,
  changePassword,
  exportAccountData,
  upsertCurrentUserPreferences,
  useUserPreferences,
} from '@ledova/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import { LinkRow, Section, SwitchRow } from '@components/Ledger';

function ActionRow({ description, label, onClick }: { description: string; label: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <p className="min-w-0 flex-1 basis-64 text-sm text-text-muted">{description}</p>
      <PageAction label={label} onClick={onClick} />
    </div>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1">
      <label className="flex flex-col gap-1 text-sm text-text-muted">
        {label}
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          className="min-w-0 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid"
        />
      </label>
      <button
        type="button"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible(!visible)}
        className="text-sm text-brand-mid underline"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const transactionAlerts = preferences.preferences?.transactionAlerts;
  const alerts = useMutation({
    mutationFn: (value: boolean) => upsertCurrentUserPreferences(apiClient, { transactionAlerts: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
  });
  const [modal, setModal] = useState<'password' | 'export' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(apiClient),
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      queryClient.clear();
      navigate('/signin');
    },
  });
  const passwordMutation = useMutation({
    mutationFn: () => changePassword(apiClient, { currentPassword, newPassword, newPasswordConfirm: confirmPassword }),
    onSuccess: () => {
      setModal(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordChanged(true);
    },
    onError: (error: unknown) => {
      const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data;
      if (data?.current_password || data?.currentPassword) setPasswordError('Current password is incorrect.');
      else if (data?.new_password || data?.newPassword)
        setPasswordError('The new password was not accepted. Choose another password.');
      else if (data?.new_password_confirm || data?.newPasswordConfirm) setPasswordError('Passwords do not match.');
      else setPasswordError('Your password could not be changed. Try again.');
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => exportAccountData(apiClient),
    onSuccess: (response) => {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ledova-data-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setModal(null);
    },
  });

  function closePassword() {
    if (passwordMutation.isPending) return;
    setModal(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    passwordMutation.reset();
  }

  function savePassword() {
    if (passwordMutation.isPending) return;
    setPasswordError('');
    if (!currentPassword || !newPassword || !confirmPassword) setPasswordError('All fields are required.');
    else if (newPassword.length < 8) setPasswordError('New password must be at least 8 characters.');
    else if (newPassword !== confirmPassword) setPasswordError('Passwords do not match.');
    else passwordMutation.mutate();
  }

  return (
    <Page>
      <Section title="Profile and security">
        <div className="divide-y divide-border-subtle">
          <LinkRow to={DESTINATIONS.userProfile.path} label={DESTINATIONS.userProfile.title}>
            <p className="text-text-muted">View your personal information and identity check.</p>
          </LinkRow>
          <ActionRow
            description="Choose a new password for your account."
            label="Change password"
            onClick={() => {
              setPasswordChanged(false);
              setModal('password');
            }}
          />
        </div>
        {passwordChanged && (
          <p role="status" className="text-sm text-brand-mid">
            Your password was changed.
          </p>
        )}
      </Section>
      <Section title="Notifications">
        {preferences.isError ? (
          <>
            <p role="alert" className="text-sm text-error-light">
              Notification preferences could not be loaded.
            </p>
            <PageAction label="Try again" onClick={() => void preferences.refetch()} />
          </>
        ) : preferences.isLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading notification preferences…
          </p>
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
        onClose={closePassword}
        title="Change password"
        showFooter
        confirmLabel="Change password"
        onConfirm={savePassword}
        confirmLoading={passwordMutation.isPending}
        confirmDisabled={!currentPassword || !newPassword || !confirmPassword}
      >
        {modal === 'password' && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              savePassword();
            }}
          >
            <PasswordInput
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              disabled={passwordMutation.isPending}
            />
            <PasswordInput
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              disabled={passwordMutation.isPending}
            />
            <PasswordInput
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={passwordMutation.isPending}
            />
            {passwordError && (
              <p role="alert" className="text-sm text-error-light">
                {passwordError}
              </p>
            )}
            <button type="submit" className="sr-only" tabIndex={-1} disabled={passwordMutation.isPending}>
              Save password
            </button>
          </form>
        )}
      </Modal>
      <Modal
        isOpen={modal === 'export'}
        onClose={() => {
          if (!exportMutation.isPending) setModal(null);
        }}
        title="Export data"
        showFooter
        confirmLabel="Export"
        onConfirm={() => exportMutation.mutate()}
        confirmLoading={exportMutation.isPending}
      >
        <p className="text-sm text-text-muted">
          Download your account data as a JSON file. The download starts when the export is ready.
        </p>
        {exportMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-error-light">
            Your data could not be exported. Try again.
          </p>
        )}
      </Modal>
      <Modal
        isOpen={modal === 'delete'}
        onClose={() => {
          if (!deleteMutation.isPending) setModal(null);
        }}
        title="Delete account"
        showFooter
        confirmLabel="Delete account"
        onConfirm={() => deleteMutation.mutate()}
        confirmLoading={deleteMutation.isPending}
      >
        <p className="mb-3 text-sm font-medium">This action cannot be undone.</p>
        <p className="text-sm text-text-muted">
          This deactivates your account and removes your name, date of birth, phone number and address. Your country of
          citizenship, financial profile, wallets, verification records and share register entries are kept.
        </p>
        {deleteMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-error-light">
            Your account could not be deleted. Try again or contact the deployment operator.
          </p>
        )}
      </Modal>
    </Page>
  );
}

export default SettingsPage;
