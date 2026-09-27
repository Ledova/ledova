import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, Text, View } from 'react-native';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { useThemedStyles } from '../../../contexts';

export function CryptoActions() {
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  const styles = useThemedStyles((theme) => ({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
    button: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
    },
    label: { fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
  }));
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => navigation.navigate('Buy', { screen: 'BuySelect' })}
      >
        <Text style={styles.label}>Buy crypto</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => navigation.navigate('Send', { screen: 'SendMain' })}
      >
        <Text style={styles.label}>Send</Text>
      </Pressable>
    </View>
  );
}
