import { createContext } from 'react';

export const PhoneBar = createContext<{
  phone: boolean;
  actions: HTMLDivElement | null;
  setTitle: (title: string | null) => void;
}>({ phone: false, actions: null, setTitle: () => {} });
