import { useState, type ReactNode } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { VERIFICATION_TONES, formatDate, formatDateTime, getUserVerificationStatus } from '@ledova/shared';
import { Action, Fact, Rows, Section, Status, SwitchRow } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useAppLock, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useUserProfile } from '../../hooks/useUserProfile';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { useMemberRecordsState } from '../holdings/MemberRecordsProvider';
import { useSettings } from './useSettings';

function useAccountStyles() {
  return useThemedStyles((theme) => ({
    setting: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 16,
      paddingVertical: theme.spacing.smd,
    },
    text: { flex: 1, gap: theme.spacing.xs },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
  }));
}

function SettingRow({
  label,
  detail,
  action,
  accessibilityLabel,
}: {
  label?: string;
  detail?: ReactNode;
  action?: ReactNode;
  accessibilityLabel?: string;
}) {
  const look = useAccountStyles();
  return (
    <View style={look.setting}>
      <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} style={look.text}>
        {!!label && <Text style={look.label}>{label}</Text>}
        {detail}
      </View>
      {!!action && <View>{action}</View>}
    </View>
  );
}

export function AccountSettings() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const lock = useAppLock();
  const { userProfile } = useUserProfile();
  const { company } = useMemberRecordsState();
  const verification = getUserVerificationStatus(userProfile);
  const settings = useSettings();
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityPending, setSecurityPending] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const busy = settings.isChangingPassword;
  const close = () => {
    if (busy) return;
    setChanging(false);
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
        `Disable ${lock.biometricType} sign-in`,
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
      setChanging(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords(false);
    } else setError('Your password could not be changed. Check the details and try again.');
  };
  return (
    <>
      <Section title="Security">
        <Rows>
          {userProfile && (
            <SettingRow
              label="Identity check"
              accessibilityLabel={`Identity check: ${verification.label}`}
              action={
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Status tone={VERIFICATION_TONES.get(verification.type) ?? 'waiting'} muted>
                    {verification.label}
                  </Status>
                </View>
              }
            />
          )}
          <SettingRow
            label="Password"
            action={
              <Action
                label="Change"
                accessibilityLabel="Change password"
                onPress={() => {
                  if (busy) return;
                  setError(null);
                  setChanging(true);
                }}
              />
            }
          />
          <SwitchRow
            label={`${lock.biometricType} sign-in`}
            checked={lock.hasBiometricLogin}
            disabled={!lock.biometricsAvailable || securityPending}
            onChange={biometricLogin}
          />
          <SwitchRow
            label="App lock"
            description={`Ask for ${lock.biometricType} when you come back.`}
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
      </Section>
      {userProfile && (
        <Section title="Account details">
          <Rows>
            <Fact label="Member since">{formatDate(userProfile.dateJoined, 'Not available')}</Fact>
            <Fact label="Last login">{formatDateTime(userProfile.lastLogin)}</Fact>
          </Rows>
        </Section>
      )}
      <Section title="Invitations">
        <Rows>
          <SettingRow
            label="Shareholder invitation"
            detail={<Text style={styles.muted}>Use the link or code from your company’s email.</Text>}
            action={
              <Action
                label="Accept"
                accessibilityLabel="Accept shareholder invitation"
                onPress={() => navigation.navigate('Invitation')}
              />
            }
          />
          {!company?.canManage && (
            <SettingRow
              label="Company officer invitation"
              detail={<Text style={styles.muted}>Use the code the company gave you.</Text>}
              action={
                <Action
                  label="Accept"
                  accessibilityLabel="Accept company officer invitation"
                  onPress={() => navigation.navigate('Team')}
                />
              }
            />
          )}
        </Rows>
      </Section>
      <CustomModal
        visible={changing}
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
    </>
  );
}

export function AccountData() {
  const styles = useCompanyStyles();
  const settings = useSettings();
  const [modal, setModal] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = settings.isExporting || settings.isDeleting;
  const open = (kind: typeof modal) => {
    if (!busy) {
      setError(null);
      setModal(kind);
    }
  };
  const close = () => {
    if (busy) return;
    setModal(null);
    setError(null);
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
      <Section title="Your data">
        <Rows>
          <SettingRow
            label="Export data"
            detail={<Text style={styles.muted}>Save or share a copy of your account data.</Text>}
            action={<Action label="Export" accessibilityLabel="Export data" onPress={() => open('export')} />}
          />
          <SettingRow
            label="Delete account"
            detail={
              <Text style={styles.muted}>
                Deactivates your account and removes personal details. Some records are retained.
              </Text>
            }
            action={<Action label="Delete" accessibilityLabel="Delete account" onPress={() => open('delete')} />}
          />
        </Rows>
      </Section>
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
          entries are kept.
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
