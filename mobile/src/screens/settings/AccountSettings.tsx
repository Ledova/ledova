import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { VERIFICATION_TONES, formatDate, formatDateTime, getUserVerificationStatus } from '@ledova/shared';
import { Action, Fact, FormActions, Rows, Section, Status, SwitchRow } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useAppLock, useThemeChoice, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { useUserProfile } from '../../hooks/useUserProfile';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { useSettings } from './useSettings';

function useAccountStyles() {
  return useThemedStyles((theme) => ({
    row: { gap: theme.spacing.smd, paddingVertical: theme.spacing.smd },
    action: { alignSelf: 'flex-end' as const },
    identity: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.smd,
    },
    end: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, paddingVertical: theme.spacing.smd },
    manage: {
      gap: theme.spacing.smd,
      paddingTop: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
  }));
}

function ActionRow({ description, label, onPress }: { description: string; label: string; onPress: () => void }) {
  const styles = useCompanyStyles();
  const look = useAccountStyles();
  return (
    <View style={look.row}>
      <Text style={styles.muted}>{description}</Text>
      <View style={look.action}>
        <Action label={label} onPress={onPress} />
      </View>
    </View>
  );
}

export function AccountSettings({ profile }: { profile: ReturnType<typeof useUserProfile> }) {
  const styles = useCompanyStyles();
  const look = useAccountStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const lock = useAppLock();
  const appearance = useThemeChoice();
  const { userProfile } = profile;
  const verification = getUserVerificationStatus(userProfile);
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
      <Section title="Account">
        <Rows>
          {userProfile && (
            <View accessible accessibilityLabel={`Identity check: ${verification.label}`} style={look.identity}>
              <Text style={styles.muted}>Identity check</Text>
              <Status tone={VERIFICATION_TONES.get(verification.type) ?? 'waiting'} muted>
                {verification.label}
              </Status>
            </View>
          )}
          <ActionRow
            description="Choose a new password for your account."
            label="Change password"
            onPress={() => open('password')}
          />
          <SwitchRow
            label="Dark theme"
            description="Saved on this device."
            checked={appearance.mode === 'dark'}
            onChange={(dark) => appearance.setMode(dark ? 'dark' : 'paper')}
          />
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
        </Rows>
        {!lock.biometricsAvailable && (
          <Text style={styles.muted}>Biometric security is not available on this device.</Text>
        )}
        {securityError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {securityError}
          </Text>
        )}
        <View style={look.manage}>
          <Text accessibilityRole="header" style={look.heading}>
            Manage account
          </Text>
          {userProfile && (
            <Rows>
              <Fact label="Member since">{formatDate(userProfile.dateJoined, 'Not available')}</Fact>
              <Fact label="Last login">{formatDateTime(userProfile.lastLogin)}</Fact>
            </Rows>
          )}
          <Rows>
            <View style={look.end}>
              <Action label="Accept an invitation" onPress={() => navigation.navigate('Invitation')} />
            </View>
            <ActionRow
              description="Download a copy of your account data."
              label="Export data"
              onPress={() => open('export')}
            />
            <ActionRow
              description="Deactivate your account and remove personal details. Some records are retained."
              label="Delete account"
              onPress={() => open('delete')}
            />
          </Rows>
        </View>
        <FormActions>
          <Action
            label="Rate the app"
            onPress={() => {
              setAppError(null);
              void settings.rateApp().catch(() => setAppError('The app-store listing could not be opened.'));
            }}
          />
          <Action label="Share with friends" onPress={() => void settings.shareApp()} />
        </FormActions>
        {appError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {appError}
          </Text>
        )}
      </Section>
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
          <View key={label} style={styles.group}>
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
          This deactivates your account and removes your name, date of birth, phone number and address from your
          profile. Your country of citizenship, financial profile, wallets, verification records and share register
          entries are kept, and so are the eligibility requests you sent, with your name as each company received it.
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
