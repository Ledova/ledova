import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { Action } from '../../../components/Ledger';

export function CryptoActions() {
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  return (
    <>
      <Action label="Buy crypto" onPress={() => navigation.navigate('Buy', { screen: 'BuySelect' })} />
      <Action label="Send" onPress={() => navigation.navigate('Send', { screen: 'SendMain' })} />
    </>
  );
}
