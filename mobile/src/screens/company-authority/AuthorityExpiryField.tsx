import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatDateTime } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

export function AuthorityExpiryField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const styles = useCompanyStyles();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Requested expiry</Text>
      <Text style={styles.muted}>{value ? formatDateTime(value) : 'No expiry requested'}</Text>
      <Action label="Choose expiry date" disabled={disabled} onPress={() => setMode('date')} />
      <Action label="Choose expiry time" disabled={disabled || !value} onPress={() => setMode('time')} />
      {!!value && <Action label="Remove requested expiry" disabled={disabled} onPress={() => onChange('')} />}
      {mode && !disabled && (
        <>
          <DateTimePicker
            testID="authority-expiry"
            value={value ? new Date(value) : new Date()}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              if (Platform.OS === 'android') setMode(null);
              if (event.type === 'set' && selected) onChange(selected.toISOString());
            }}
          />
          {Platform.OS === 'ios' && <Action label="Done choosing expiry" onPress={() => setMode(null)} />}
        </>
      )}
    </View>
  );
}
