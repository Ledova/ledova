import { useSubmissionOwner, useUserPreferences } from '@ledova/shared';

export function useRegisterPreparationOwner() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return { owner, boundary, preferences };
}
