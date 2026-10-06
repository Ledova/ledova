import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Action } from '../../components/Ledger';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export function EligibilityLinks({
  participant = false,
  company = false,
}: {
  participant?: boolean;
  company?: boolean;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const open = (screen: 'ParticipantEligibility' | 'CompanyEligibility') =>
    navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Home', params: { screen } } } as never);
  return (
    <>
      {participant && <Action label="Eligibility requests" onPress={() => open('ParticipantEligibility')} />}
      {company && <Action label="Company eligibility" onPress={() => open('CompanyEligibility')} />}
    </>
  );
}
