import type { ApiRequest, ApiSchema } from '../contracts';

export type UserProfile = ApiSchema<'UserProfile'>;

export type UpdateUserProfile = ApiRequest<'api_user_profiles_partial_update'>;

export type CompleteUserProfile = Pick<UpdateUserProfile, 'termsAndConditions' | 'isSignupCompleted'>;

export interface UserProfileFormData {
  fullName: string;
  dateOfBirth: string;
  phoneCountryCode: string;
  phoneNumber: string;
  residentialAddress: string;
}
