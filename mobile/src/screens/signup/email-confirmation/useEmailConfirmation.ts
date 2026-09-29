import { useState, useEffect } from 'react';
import { useEmailVerification } from '@ledova/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storeTokens } from '../../../services/tokenStorage';

export const useEmailConfirmation = () => {
  const [email, setEmail] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('signup_email').then((storedEmail) => {
      if (storedEmail) {
        setEmail(storedEmail);
      }
    });
  }, []);

  return useEmailVerification(email, async (response) => {
    if (response.data?.tokens && response.data.tokens.length > 0) {
      const token = response.data.tokens[0];
      if (token.accessToken && token.refreshToken) {
        await storeTokens({ accessToken: token.accessToken, refreshToken: token.refreshToken });
      }
    }
  });
};
