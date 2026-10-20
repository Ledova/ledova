import { Text } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { COMPANY_ACTIVATION_COPY } from '@ledova/shared';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import { LinkRow, Status } from './Ledger';

export function SetupStep({
  label,
  note,
  done,
  onPress,
}: {
  label: string;
  note: string;
  done: boolean;
  onPress: () => void;
}) {
  const styles = useCompanyStyles();
  const status = done ? 'Done' : 'To do';
  return (
    <LinkRow
      label={label}
      accessibilityLabel={`${label}, ${status}`}
      onPress={onPress}
      aside={<Status tone={done ? 'done' : 'waiting'}>{status}</Status>}
    >
      <Text style={styles.muted}>{note}</Text>
    </LinkRow>
  );
}

export function ActivationStep({ done }: { done: boolean }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return (
    <SetupStep
      label={COMPANY_ACTIVATION_COPY.STEP}
      note={COMPANY_ACTIVATION_COPY.CHECKS}
      done={done}
      onPress={() =>
        navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Listing' }, pop: true } as never)
      }
    />
  );
}
