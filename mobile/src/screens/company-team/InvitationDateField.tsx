import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatDateTime } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

export function InvitationDateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const styles = useCompanyStyles();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{label}</Text>
      <Text style={styles.muted}>{value ? formatDateTime(value) : 'Use default'}</Text>
      <Action label={`Choose ${label.toLowerCase()} date`} disabled={disabled} onPress={() => setMode('date')} />
      <Action
        label={`Choose ${label.toLowerCase()} time`}
        disabled={disabled || !value}
        onPress={() => setMode('time')}
      />
      {!!value && <Action label={`Remove ${label.toLowerCase()}`} disabled={disabled} onPress={() => onChange('')} />}
      {mode && !disabled && (
        <>
          <DateTimePicker
            testID={`team-date-${label}`}
            value={value ? new Date(value) : new Date()}
            minimumDate={new Date()}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              if (Platform.OS === 'android') setMode(null);
              if (event.type === 'set' && selected) onChange(selected.toISOString());
            }}
          />
          {Platform.OS === 'ios' && (
            <Action label={`Done choosing ${label.toLowerCase()}`} onPress={() => setMode(null)} />
          )}
        </>
      )}
    </View>
  );
}
