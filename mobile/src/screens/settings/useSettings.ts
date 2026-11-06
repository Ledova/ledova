import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorSentence, deleteAccount, exportAccountData, changePassword } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { getSessionEpoch } from '../../services/sessionScope';
import { clearTokens } from '../../services/tokenStorage';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export function useSettings() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();

  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const changeUserPassword = useCallback(
    async (currentPassword: string, newPassword: string, newPasswordConfirm: string): Promise<string | null> => {
      setIsChangingPassword(true);
      try {
        await changePassword(apiClient, { currentPassword, newPassword, newPasswordConfirm });
        return null;
      } catch (error: unknown) {
        const failed = 'Your password could not be changed. Try again.';
        return apiErrorSentence(error, failed, failed);
      } finally {
        setIsChangingPassword(false);
      }
    },
    [],
  );

  const exportData = useCallback(async (): Promise<string | null> => {
    const sessionEpoch = getSessionEpoch();
    setIsExporting(true);
    try {
      if (!(await Sharing.isAvailableAsync())) return 'Sharing is not available on this device.';
      await shareDocumentCopy(
        sessionEpoch,
        async () => {
          const response = await exportAccountData(apiClient, { ledovaSessionEpoch: sessionEpoch });
          return {
            name: `ledova-data-export-${new Date().toISOString().split('T')[0]}.json`,
            type: 'application/json',
            bytes: new TextEncoder().encode(JSON.stringify(response.data, null, 2)),
          };
        },
        (uri, type) =>
          Sharing.shareAsync(uri, { mimeType: type, UTI: 'public.json', dialogTitle: 'Ledova - Account Data Export' }),
      );
      return null;
    } catch {
      return 'Your data could not be exported. Try again.';
    } finally {
      setIsExporting(false);
    }
  }, []);

  const deleteUserAccount = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true);
    try {
      await deleteAccount(apiClient);
    } catch {
      setIsDeleting(false);
      return false;
    }

    const retired = await clearTokens().then(
      () => true,
      () => false,
    );
    queryClient.clear();

    navigation.reset({
      index: 0,
      routes: [{ name: 'SignIn' }],
    });

    setIsDeleting(false);
    if (!retired) {
      Alert.alert(
        'Account Deleted',
        'Your account was deleted, but this device could not confirm that your saved sign-in was removed.',
      );
    }
    return true;
  }, [navigation, queryClient]);

  return {
    changeUserPassword,
    isChangingPassword,

    exportData,
    isExporting,

    deleteUserAccount,
    isDeleting,
  };
}
