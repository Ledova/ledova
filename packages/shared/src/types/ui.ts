import type { UserProfile } from './domain';
import type { FieldValidation, FormValidation } from './validation';

export interface ReviewData {
  userProfile: UserProfile | null;
}

export interface UserProfileFormValidation extends FormValidation {
  fullName: FieldValidation;
}

export interface PasswordValidation {
  isValid: boolean;
  lengthValid: boolean;
  notNumeric: boolean;
}

export interface EmailConfirmationValidation {
  isValid: boolean;
  isEmpty: boolean;
  isValidFormat: boolean;
}
