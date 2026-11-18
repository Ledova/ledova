import { useState } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemberRecordsState, useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../navigation/SignedInNavigator';

export function CompanyContextNotice() {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    link: { color: theme.colors.brand.light, textDecorationLine: 'underline' as const },
  }));
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { company } = useMemberRecordsState();
  const [stayed, setStayed] = useState(false);
  const choose = () => {
    const before = navigation.getState();
    navigation.popTo('Dashboard');
    requestAnimationFrame(() => {
      if (navigation.isFocused() && navigation.getState() === before) setStayed(true);
    });
  };
  return (
    <Text style={styles.muted}>
      {company && 'The selected company is unavailable for this page. '}
      <Text accessibilityRole="link" style={look.link} onPress={choose}>
        Choose company on Dashboard
      </Text>
      .{stayed && ' A request on this page has not finished yet. Try again when it has.'}
    </Text>
  );
}
