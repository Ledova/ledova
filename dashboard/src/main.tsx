import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/instrument-sans';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false },
  },
});
for (const queryKey of [AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY]) {
  queryClient.setQueryDefaults(queryKey, { refetchOnWindowFocus: true, refetchOnReconnect: true });
}
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
