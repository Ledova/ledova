import { createContext, type ReactNode } from 'react';

export const InSignedInFrame = createContext(false);

export type FrameOptions = { title?: string; action?: ReactNode };
