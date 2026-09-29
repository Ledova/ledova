import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { USER_PREFERENCES_QUERY_KEY, upsertCurrentUserPreferences, useUserPreferences } from '@ledova/shared';
import { Action, Section, SwitchRow } from '../../components/Ledger';
import { useAppLock } from '../../contexts';
import { apiClient } from '../../services/apiClient';
import { AccountModal } from '../account/AccountModal';
import { useAccountStyles } from '../account/styles';
import { useSettings } from './useSettings';

export function SettingsScreen() {
  const styles = useAccountStyles();
  const lock = useAppLock();
  const preferences = useUserPreferences();
  const transactionAlerts = preferences.preferences?.transactionAlerts;
  const queryClient = useQueryClient();
  const alerts = useMutation({
    mutationFn: (value: boolean) => upsertCurrentUserPreferences(apiClient, { transactionAlerts: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
  });
  const settings = useSettings();
  const [modal, setModal] = useState<'password' | 'export' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityPending, setSecurityPending] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const busy = settings.isChangingPassword || settings.isExporting || settings.isDeleting;
  const open = (kind: typeof modal) => {
    if (!busy) {
      setError(null);
      setModal(kind);
    }
  };
  const close = () => {
    if (busy) return;
    setModal(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setError(null);
  };
  const secure = async (action: () => Promise<unknown>) => {
    if (securityPending) return;
    setSecurityPending(true);
    setSecurityError(null);
    try {
      if ((await action()) === false) setSecurityError('Authentication could not be completed. Try again.');
    } catch {
      setSecurityError('This security setting could not be changed. Try again.');
    } finally {
      setSecurityPending(false);
    }
  };
  const biometricLogin = (enabled: boolean) => {
    if (enabled) void secure(lock.enableBiometricLogin);
    else
      Alert.alert(
        `Disable ${lock.biometricType} sign in`,
        'You will need your email and password next time you sign in.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disable', style: 'destructive', onPress: () => void secure(lock.disableBiometricLogin) },
        ],
      );
  };
  const savePassword = async () => {
    if (busy) return;
    setError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Fill in all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    if (await settings.changeUserPassword(currentPassword, newPassword, confirmPassword)) {
      setModal(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords(false);
    } else setError('Your password could not be changed. Check the details and try again.');
  };
  const exportData = async () => {
    if (busy) return;
    setError(null);
    if (await settings.exportData()) setModal(null);
    else setError('Your data could not be exported. Try again.');
  };
  const deleteAccount = async () => {
    if (busy) return;
    setError(null);
    if (await settings.deleteUserAccount()) setModal(null);
    else setError('Your account could not be deleted. Try again or contact the deployment operator.');
  };
  return (
    <>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Settings
        </Text>
        <Section title="Security">
          <SwitchRow
            label={`${lock.biometricType} sign in`}
            description={`Sign in with ${lock.biometricType} instead of your password.`}
            checked={lock.hasBiometricLogin}
            disabled={!lock.biometricsAvailable || securityPending}
            onChange={biometricLogin}
          />
          <SwitchRow
            label="App lock"
            description={`Require ${lock.biometricType} after the app goes into the background.`}
            checked={lock.isEnabled}
            disabled={!lock.biometricsAvailable || securityPending}
            onChange={(value) => void secure(() => lock.setEnabled(value))}
          />
          {!lock.biometricsAvailable && (
            <Text style={styles.muted}>Biometric security is not available on this device.</Text>
          )}
          {securityError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {securityError}
            </Text>
          )}
        </Section>
        <Section title="Notifications">
          {preferences.isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading notification settings" />
          ) : preferences.isError || transactionAlerts === undefined ? (
            <View style={styles.fields}>
              <Text accessibilityRole="alert" style={styles.error}>
                Your notification settings could not be loaded.
              </Text>
              <Action
                label="Try notifications again"
                disabled={preferences.isFetching}
                onPress={() => void preferences.refetch()}
              />
            </View>
          ) : (
            <SwitchRow
              label="Transaction alerts"
              description="Notifications for transaction status changes."
              checked={transactionAlerts}
              disabled={alerts.isPending || preferences.isFetching}
              onChange={(value) => alerts.mutate(value)}
            />
          )}
          {alerts.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              Your notification setting could not be saved. Try again.
            </Text>
          )}
        </Section>
        <Section title="Account">
          <Action label="Change password" disabled={busy} onPress={() => open('password')} />
          <Text style={styles.muted}>Save a private JSON copy of your account data.</Text>
          <Action label="Export data" disabled={busy} onPress={() => open('export')} />
          <Text style={styles.muted}>
            Deactivate your account and remove personal details. Some records are retained.
          </Text>
          <Action label="Delete account" disabled={busy} onPress={() => open('delete')} />
        </Section>
        <Section title="App">
          <Action
            label="Rate the app"
            onPress={() => {
              setAppError(null);
              void settings.rateApp().catch(() => setAppError('The app-store listing could not be opened.'));
            }}
          />
          <Action label="Share with friends" onPress={() => void settings.shareApp()} />
          {appError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {appError}
            </Text>
          )}
        </Section>
      </ScrollView>
      <AccountModal
        visible={modal === 'password'}
        title="Change password"
        busy={busy}
        onClose={close}
        actions={
          <Action
            label={settings.isChangingPassword ? 'Saving…' : 'Save password'}
            primary
            disabled={busy}
            onPress={() => void savePassword()}
          />
        }
      >
        {(
          [
            ['Current password', currentPassword, setCurrentPassword],
            ['New password', newPassword, setNewPassword],
            ['Confirm new password', confirmPassword, setConfirmPassword],
          ] as const
        ).map(([label, value, onChange]) => (
          <View key={label} style={styles.fields}>
            <Text style={styles.muted}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              value={value}
              onChangeText={onChange}
              style={styles.input}
              editable={!busy}
              secureTextEntry={!showPasswords}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ))}
        <Action
          label={showPasswords ? 'Hide passwords' : 'Show passwords'}
          disabled={busy}
          onPress={() => setShowPasswords(!showPasswords)}
        />
        <Text style={styles.muted}>Use at least 8 characters for the new password.</Text>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </AccountModal>
      <AccountModal
        visible={modal === 'export'}
        title="Export data"
        busy={busy}
        onClose={close}
        actions={
          <Action
            label={settings.isExporting ? 'Exporting…' : 'Export'}
            primary
            disabled={busy}
            onPress={() => void exportData()}
          />
        }
      >
        <Text style={styles.text}>
          Save or share your account data as a private JSON file. The share sheet opens when the export is ready.
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </AccountModal>
      <AccountModal
        visible={modal === 'delete'}
        title="Delete account"
        busy={busy}
        onClose={close}
        actions={
          <Action
            label={settings.isDeleting ? 'Deleting…' : 'Confirm deletion'}
            primary
            disabled={busy}
            onPress={() => void deleteAccount()}
          />
        }
      >
        <Text style={styles.text}>This action cannot be undone.</Text>
        <Text style={styles.text}>
          This deactivates your account and removes your name, date of birth, phone number and address. Your country of
          citizenship, financial profile, wallets, verification records and share register entries are kept.
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </AccountModal>
    </>
  );
}
