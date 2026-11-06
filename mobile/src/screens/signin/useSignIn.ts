import { signin, useAuth, useSignInForm } from '@ledova/shared';
import { apiClient, isRefreshRefusal, rotateRefreshToken, UserFriendlyError } from '../../services/apiClient';
import { storeTokens } from '../../services/tokenStorage';
import { notificationsService } from '../../services/notificationsService';

export const useSignIn = () => {
  const { refetch: refetchAuth } = useAuth();

  const { validateForm, showFailure, setGeneralError, setIsLoading, ...state } = useSignInForm();

  const completeSignIn = async (onSuccess?: () => void) => {
    await refetchAuth();

    notificationsService.registerToken().catch(() => {});

    if (onSuccess) {
      onSuccess();
    }
  };

  const performLogin = async (email: string, password: string, onSuccess?: () => void): Promise<boolean> => {
    try {
      const response = await signin(apiClient, { email, password });

      const token = response.data?.tokens?.[0];
      if (token?.accessToken && token?.refreshToken) {
        await storeTokens({ accessToken: token.accessToken, refreshToken: token.refreshToken });
      }
      await completeSignIn(onSuccess);
      return true;
    } catch (err: unknown) {
      showFailure(err);
      return false;
    }
  };

  const handleSubmit = async (onSuccess?: () => void) => {
    setGeneralError(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await performLogin(state.form.email, state.form.password, onSuccess);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithRefreshToken = async (refreshToken: string, onSuccess?: () => void): Promise<boolean> => {
    setGeneralError(null);
    setIsLoading(true);

    try {
      await rotateRefreshToken(refreshToken);
      await completeSignIn(onSuccess);
      return true;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'isUserFriendly' in err) {
        setGeneralError((err as UserFriendlyError).message);
      } else if (isRefreshRefusal(err)) {
        setGeneralError('Your saved sign in has expired. Please sign in with your password.');
      } else {
        setGeneralError('Biometric sign in is temporarily unavailable. Please try again.');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    ...state,
    handleSubmit,
    loginWithRefreshToken,
    setGeneralError,
  };
};
