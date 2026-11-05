import { createContext } from 'react';
import type { To } from 'react-router-dom';

export const PageTitle = createContext<string | undefined>(undefined);
export const PageActionsTarget = createContext<HTMLDivElement | null>(null);

export interface PageBackLink {
  to: To;
  label: string;
  state?: unknown;
}

export const PageBack = createContext<PageBackLink | undefined>(undefined);
