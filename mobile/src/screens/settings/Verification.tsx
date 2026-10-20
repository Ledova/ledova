import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { IDENTITY_CHECK_COPY, companiesAwaitingActivation, getUserVerificationStatus } from '@ledova/shared';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { LinkRow, Rows, Section, Status, type Tone } from '../../components/Ledger';
import { ActivationStep } from '../../components/SetupStep';
import { useRegisterAppointments } from '../../hooks/useCompanyRegister';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useUserProfile } from '../../hooks/useUserProfile';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';

const VERIFICATION_TONES = new Map<string, Tone>([
  ['verified', 'done'],
  ['rejected', 'closed'],
]);

export function Verification() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const { appointments } = useRegisterAppointments(epoch, '');
  const { userProfile } = useUserProfile();
  const own = appointments.data ?? [];
  const administers = own.some((appointment) => appointment.isEffective && appointment.capabilities.includes('admin'));
  const identity = getUserVerificationStatus(userProfile);
  return (
    <Section title={administers ? 'Verification and activation' : 'Identity'}>
      <Rows>
        {administers && <ActivationStep done={companiesAwaitingActivation(own).length === 0} />}
        <LinkRow
          label={IDENTITY_CHECK_COPY.STEP}
          accessibilityLabel={userProfile ? `${IDENTITY_CHECK_COPY.STEP}, ${identity.label}` : undefined}
          onPress={() =>
            navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Profile' }, pop: true } as never)
          }
          aside={
            userProfile && <Status tone={VERIFICATION_TONES.get(identity.type) ?? 'waiting'}>{identity.label}</Status>
          }
        >
          <Text style={styles.muted}>{IDENTITY_CHECK_COPY.NOTE}</Text>
        </LinkRow>
      </Rows>
    </Section>
  );
}
