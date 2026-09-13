export type AccountRole = 'investor' | 'company' | 'both';

export interface UserAccount {
  uuid: string;
  accountNumber: string;
  accountType: string;
  activationDate: string | null;
  role: AccountRole;
  director: string | null;
}

export interface AccountSummary {
  uuid: string;
  accountNumber: string;
  accountType: string;
  activationDate: string | null;
  role: AccountRole;
}

export interface SelectedPortfolio {
  uuid: string;
  name: string;
  userAccount: string;
  isActive: boolean;
}

export type Theme = 'dark' | 'light';
export type DisplayCurrency = 'AUD' | 'USD';

export interface UserPreferences {
  uuid: string;
  userProfile: string;
  userAccount: AccountSummary | null;
  selectedPortfolio: SelectedPortfolio | null;
  theme: Theme;
  displayCurrency: DisplayCurrency;
}

export type UpdateUserPreferences = Partial<Pick<UserPreferences, 'theme' | 'displayCurrency'>> & {
  selectedPortfolio?: string | null;
};
