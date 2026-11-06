import { resetSessionQueries } from '@utils/session';
import { useQueryClient } from '@tanstack/react-query';
import { signin, useSignInForm } from '@ledova/shared';
import apiClient from '@services/apiClient';

export const useSignIn = () => {
  const queryClient = useQueryClient();
  const { validateForm, showFailure, setGeneralError, setIsLoading, ...state } = useSignInForm();

  const handleSubmit = async (onSuccess?: () => void) => {
    setGeneralError(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await signin(apiClient, state.form);

      await resetSessionQueries(queryClient);

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      showFailure(err);
    } finally {
      setIsLoading(false);
    }
  };

  return { ...state, handleSubmit };
};
