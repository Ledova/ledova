import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING } from '@hooks/useOwnAppointments';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/instrument-sans';
import './styles/index.css';

const queryClient = new QueryClient();
queryClient.setQueryDefaults(USER_PREFERENCES_QUERY_KEY, {
  refetchOnWindowFocus: READ_TIMING.refetchOnWindowFocus,
  refetchOnReconnect: READ_TIMING.refetchOnReconnect,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
