import type { FinancialProfile } from '../../types/domain/investment';

export const INTENDED_USE_OPTIONS = [
  { value: 'long_term_investment', label: 'Long-term investment' },
  { value: 'trading_crypto', label: 'Trading crypto currencies' },
  { value: 'savings', label: 'Savings' },
  { value: 'other', label: 'Other' },
] satisfies Array<{ value: NonNullable<FinancialProfile['intendedUse']>; label: string }>;
