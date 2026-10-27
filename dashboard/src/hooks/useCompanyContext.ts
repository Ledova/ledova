import { createContext, useContext } from 'react';
import type { useOwnershipCompanies, OwnershipCompany } from './useOwnershipCompanies';

export interface CompanyContextValue {
  directory: ReturnType<typeof useOwnershipCompanies>;
  companyUuid: string | null;
  company: OwnershipCompany | undefined;
  held: boolean;
  selectCompany: (uuid: string | null, preservePage?: boolean) => boolean;
  companyPath: (path: string) => string;
  openDashboard: () => boolean;
}

export const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompanyContext() {
  return useContext(CompanyContext);
}
