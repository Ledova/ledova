import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SendStackParamList } from '../../navigation/SendStackNavigator';
import { SendFormScreen } from './components/SendFormScreen';

export function SendScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SendStackParamList>>();
  const route = useRoute<RouteProp<SendStackParamList, 'SendMain'>>();

  const handleDone = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return <SendFormScreen onDone={handleDone} wallet={route.params?.wallet} />;
}
