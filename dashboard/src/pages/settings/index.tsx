import { useState } from 'react';
import { DESTINATIONS } from '@ledova/shared';
import { useSettings } from './useSettings';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import { LinkRow, Outcome, Section, SwitchRow } from '@components/Ledger';
import { FIELD_CLASS } from '@components/fieldClass';
import { setTheme } from '@hooks/useTheme';
import { Verification } from './Verification';

function ActionRow({ description, label, onClick }: { description: string; label: string; onClick: () => void }) {
  return (
    <div className="grid items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <p className="min-w-0 text-sm text-text-muted">{description}</p>
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
          className={FIELD_CLASS}
        />
      </label>
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

function SettingsPage() {
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
    passwordError,
    passwordChanged,
    setPasswordChanged,
    deleteMutation,
    passwordMutation,
    exportMutation,
    closePassword,
    savePassword,
  } = useSettings();
  return (
    <Page narrow>
      <Verification />
      <Section title="Company settings">
        <div className="divide-y divide-border-subtle">
          <LinkRow to={DESTINATIONS.company.path} label="Company details">
            <p className="text-text-muted">Company information and administration.</p>
          </LinkRow>
          <LinkRow to={`${DESTINATIONS.company.path}#documents`} label="Company documents">
            <p className="text-text-muted">Upload optional supporting documents after company setup.</p>
          </LinkRow>
          <LinkRow to={DESTINATIONS.companyTeam.path} label="Team and appointments">
            <p className="text-text-muted">
              Invite company users, accept an invitation and manage permitted appointments.
            </p>
          </LinkRow>
        </div>
      </Section>
      <Section title="Profile and security">
        <div className="divide-y divide-border-subtle">
          <LinkRow to={DESTINATIONS.userProfile.path} label={DESTINATIONS.userProfile.title}>
            <p className="text-text-muted">View and edit your personal information.</p>
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
        {passwordChanged && <Outcome>Your password was changed.</Outcome>}
      </Section>
      <Section title="Appearance">
        <SwitchRow
          label="Dark theme"
          description="Saved in this browser."
          checked={theme === 'dark'}
          onChange={(dark) => setTheme(dark ? 'dark' : 'paper')}
        />
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
        formId="change-password"
        busy={passwordMutation.isPending}
        busyLabel="Changing password…"
        confirmDisabled={!currentPassword || !newPassword || !confirmPassword}
      >
        {modal === 'password' && (
          <form
            id="change-password"
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
            Your data could not be exported. Try again.
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
