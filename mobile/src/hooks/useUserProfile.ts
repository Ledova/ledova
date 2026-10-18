import { useUserProfile as useSharedUserProfile } from '@ledova/shared';
import { orderSubmissionSession } from '../services/orderSubmissions';

export function useUserProfile() {
  return useSharedUserProfile({ session: orderSubmissionSession });
}
