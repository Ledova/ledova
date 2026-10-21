export const FIELD_LIMITS = {
  NAME: 255,
  RESIDENTIAL_ADDRESS: 1000,
  REASON: 1000,
  ELIGIBILITY_REASON: 500,
  TERMS: 1000,
  REFERENCE: 255,
  DIRECTOR: 255,
  REGISTER_SHARES: 78,
  WHOLE_SHARES: 10,
  ORDER_SHARES: 19,
  AMOUNT: 21,
  PRICE: 19,
  WALLET_NAME: 100,
  WALLET_ADDRESS: 70,
  PROFILE_NAME: 100,
  PHONE: 15,
  PHONE_COUNTRY_CODE: 5,
  COMPANY_NAME: 255,
  ADDRESS_LINE: 255,
  CITY: 100,
  STATE: 50,
  POSTCODE: 10,
  COMPANY_PHONE: 20,
  CERTIFIER_NAME: 255,
  MEMBERSHIP_NUMBER: 50,
  CLASS_NAME: 100,
  CLASS_CODE: 5,
  EMAIL: 254,
  PASSWORD: 255,
  INVITATION_CODE: 43,
  FINANCIAL_DETAIL: 200,
  NOTE: 255,
  ACN: 11,
  ABN: 14,
  VERIFICATION_CODE: 6,
} as const;

export const INVITATION_CODE_PROBLEM = 'Enter the full invitation code the company gave you.';

export function isInvitationCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(code);
}

const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export const UPLOAD_RULE = {
  ACCEPT: 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg',
  MAX_BYTES: 10 * 1024 * 1024,
  HINT: 'PDF, PNG or JPEG, up to 10 MB.',
  REFUSAL: 'Choose a PDF, PNG or JPEG of up to 10 MB.',
} as const;

export function uploadRefusal(file: { name: string; type: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = /[^.]/.test(file.name.slice(0, dot)) ? file.name.slice(dot).toLowerCase() : '';
  const fits =
    Object.prototype.hasOwnProperty.call(UPLOAD_TYPES, extension) &&
    UPLOAD_TYPES[extension] === file.type &&
    file.size > 0 &&
    file.size <= UPLOAD_RULE.MAX_BYTES;
  return fits ? null : UPLOAD_RULE.REFUSAL;
}
