import { createContext } from 'react';
import type { PageBackLink } from './PageTitle';

export const PhoneBar = createContext<{
  phone: boolean;
  actions: HTMLDivElement | null;
  setTitle: (title: string | null) => void;
  setBack: (back: PageBackLink | null) => void;
}>({ phone: false, actions: null, setTitle: () => {}, setBack: () => {} });
