import { useState } from 'react';
import { Text, View } from 'react-native';
import type { useMemberRecords } from '@ledova/shared';
import { Action, Choice } from '../../components/Ledger';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function MemberInvitation({ read, held }: { read: ReturnType<typeof useMemberRecords>; held: boolean }) {
  const styles = useCompanyStyles();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>
        Use the one-time code privately supplied by the company for your confirmed email. It grants access to your
        member record, not company administration.
      </Text>
      <Field
        label="Member invitation code"
        value={code}
        editable={!held}
        onChange={(value) => {
          setCode(value);
          setAccepted(false);
        }}
      />
      <Choice
        accessibilityRole="checkbox"
        selected={accepted}
        disabled={held}
        label="Accept access using my signed-in account"
        onPress={() => setAccepted((value) => !value)}
      />
      <Action
        label="Accept member invitation"
        disabled={held || !accepted || !/^[A-Za-z0-9_-]{43}$/.test(code)}
        onPress={() => void read.accept(code)}
      />
    </View>
  );
}
