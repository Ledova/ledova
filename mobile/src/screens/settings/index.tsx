import { useState } from 'react';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Alert, Text, TextInput, View } from 'react-native';
import { Action, LinkRow, Rows, Section, SwitchRow } from '../../components/Ledger';
import { SignOutModal } from '../../components/auth/SignOutModal';
import { Page } from '../../components/Page';
import { useAppLock, useThemeChoice } from '../../contexts';
import { CustomModal } from '../../components/modal';
import { useAccountStyles } from '../../hooks/useAccountStyles';
import { useSignOut } from '../../hooks/useSignOut';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useSettings } from './useSettings';

export function SettingsScreen() {
  const styles = useAccountStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const lock = useAppLock();
  const appearance = useThemeChoice();
  const { userProfile } = useUserProfile();
  const { signOut, signingOut } = useSignOut();
  const [signingOutOpen, setSigningOutOpen] = useState(false);
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
      <Page title="Account">
        <Section title="Profile">
          <Rows>
            <LinkRow
              label={userProfile?.fullName || 'Your profile'}
              onPress={() => navigation.navigate('MainApp', { screen: 'Profile' })}
            >
              {userProfile?.email ? <Text style={styles.muted}>{userProfile.email}</Text> : null}
            </LinkRow>
          </Rows>
        </Section>
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
        <Section title="Appearance">
          <SwitchRow
            label="Dark theme"
            description="Saved on this device."
            checked={appearance.mode === 'dark'}
            onChange={(dark) => appearance.setMode(dark ? 'dark' : 'paper')}
          />
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
        <Action label="Sign out" disabled={signingOut} onPress={() => setSigningOutOpen(true)} />
      </Page>
      <SignOutModal
        visible={signingOutOpen}
        onClose={() => setSigningOutOpen(false)}
        onConfirm={() => void signOut()}
        isLoading={signingOut}
      />
      <CustomModal
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
      </CustomModal>
      <CustomModal
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
      </CustomModal>
      <CustomModal
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
      </CustomModal>
    </>
  );
}
