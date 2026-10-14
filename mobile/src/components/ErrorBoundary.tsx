import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useThemedStyles } from '../contexts';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary] ${error.name}: ${error.message}\n${info.componentStack}`);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return <ErrorFallback message={this.state.error?.message} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

function ErrorFallback({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      backgroundColor: theme.colors.surface.base,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: 8,
    },
    message: {
      fontSize: 14,
      color: theme.colors.text.muted,
      textAlign: 'center',
      marginBottom: 20,
    },
    button: {
      paddingHorizontal: 24,
      paddingVertical: 12,
      backgroundColor: theme.colors.brand.default,
      borderRadius: 8,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.utility.white,
    },
  }));
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{message || 'An unexpected error occurred'}</Text>
      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}
