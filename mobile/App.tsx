import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLockProvider, ThemeProvider, useAppTheme } from './src/contexts';
import { AppLockScreen } from './src/components/app-lock';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppFonts } from './src/components/AppFonts';

import { ApiClientProvider } from '@ledova/shared';
import { apiClient } from './src/services/apiClient';
import { notificationsService } from './src/services/notificationsService';

notificationsService.configure();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ThemedStatusBar() {
  const { mode } = useAppTheme();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ThemedStatusBar />
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <ApiClientProvider client={apiClient}>
              <AppFonts>
                <AppLockProvider>
                  <AppNavigator />
                  <AppLockScreen />
                </AppLockProvider>
              </AppFonts>
            </ApiClientProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
