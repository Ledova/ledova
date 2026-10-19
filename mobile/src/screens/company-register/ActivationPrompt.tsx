import { useCallback, useEffect, useRef } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import type { UseQueryResult } from '@tanstack/react-query';
import { COMPANY_ACTIVATION_COPY, companiesAwaitingActivation, type OwnCompanyAppointment } from '@ledova/shared';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { Action, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function ActivationPrompt({ appointments }: { appointments: UseQueryResult<OwnCompanyAppointment[]> }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const companies = companiesAwaitingActivation(appointments.data ?? []);
  const waiting = companies.length > 0;
  const shown = useRef(waiting);
  useEffect(() => {
    shown.current = waiting;
  }, [waiting]);
  const { refetch } = appointments;
  useFocusEffect(
    useCallback(() => {
      if (shown.current) void refetch();
    }, [refetch]),
  );
  if (!waiting) return null;
  return (
    <Section title={companies.length === 1 ? `Activate ${companies[0]!.name}` : 'Activate your companies'}>
      <Text style={styles.muted}>{COMPANY_ACTIVATION_COPY.PROMPT}</Text>
      <Action primary label={COMPANY_ACTIVATION_COPY.ACTION} onPress={() => navigation.navigate('Listing')} />
    </Section>
  );
}
