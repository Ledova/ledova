interface ValidationResult {
  isValid: boolean;
}

function validateFullName(value: string): ValidationResult {
  if (!value) return { isValid: false };
  const trimmed = value.trim();
  return { isValid: trimmed.split(/\s+/).length >= 2 };
}

export const validateUserProfileField = {
  fullName: validateFullName,
};
