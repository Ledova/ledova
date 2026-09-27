import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatDateTime } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

export function OfferingDateField({
  label,
  value,
  onChange,
  busy,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  optional?: boolean;
}) {
  const styles = useCompanyStyles();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = value ? new Date(value) : new Date();
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.muted}>
        {value ? formatDateTime(value) : optional ? 'No closing date' : 'Choose an opening date and time'}
      </Text>
      <Action label={`${label}: choose date`} disabled={busy} onPress={() => setMode('date')} />
      <Action label={`${label}: choose time`} disabled={busy || !value} onPress={() => setMode('time')} />
      {optional && !!value && <Action label="Remove closing date" disabled={busy} onPress={() => onChange('')} />}
      {mode && !busy && (
        <>
          <DateTimePicker
            testID={`offering-date-${label}`}
            value={date}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant="light"
            onChange={(event, selected) => {
              if (Platform.OS === 'android') setMode(null);
              if (event.type === 'set' && selected && !busy) onChange(selected.toISOString());
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
