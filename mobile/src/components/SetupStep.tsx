import { Linking, Text } from 'react-native';
import { COMPANY_ACTIVATION_COPY, DESTINATIONS } from '@ledova/shared';
import { WEB_APP_URL } from '../config/publicLinks';
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
  return (
    <SetupStep
      label={COMPANY_ACTIVATION_COPY.STEP}
      note={COMPANY_ACTIVATION_COPY.CHECKS}
      done={done}
      onPress={() => void Linking.openURL(`${WEB_APP_URL}${DESTINATIONS.companyListing.path}`)}
    />
  );
}
