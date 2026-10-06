import React, { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { GradientBackground } from '../../components/GradientBackground';
import { canOpen, useUserPreferences } from '@ledova/shared';
import { BuyCryptoModal } from './components/BuyCryptoModal';
import type { BuyStackParamList } from '../../navigation/BuyStackNavigator';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export function BuyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<BuyStackParamList>>();
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<BuyStackParamList, 'BuySelect'>>();
  const { userAccount } = useUserPreferences();
  const canPurchase = !!userAccount?.uuid && canOpen(userAccount.role, 'investing');
  const [showModal, setShowModal] = useState(false);

  const initialAsset = route.params?.asset;

  useFocusEffect(
    useCallback(() => {
      setShowModal(canPurchase);
    }, [canPurchase]),
  );

  const handleClose = () => {
    setShowModal(false);
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handleNavigateToWebView = (url: string, sessionEpoch: number, userAccountUuid: string) => {
    if (!canPurchase || userAccountUuid !== userAccount?.uuid) return;
    setShowModal(false);
    navigation.navigate('OnRampWebView', { url, sessionEpoch, userAccountUuid });
  };

  const handleNavigateToProfile = () => {
    rootNavigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Profile' } } as never);
  };

  return (
    <GradientBackground>
      <BuyCryptoModal
        visible={showModal && canPurchase}
        onClose={handleClose}
        onNavigateToWebView={handleNavigateToWebView}
        onNavigateToProfile={handleNavigateToProfile}
        userAccountUuid={userAccount?.uuid}
        initialAsset={initialAsset}
      />
    </GradientBackground>
  );
}
