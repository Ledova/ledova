import React from 'react';
import { PAPER_THEME } from '@ledova/shared';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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

      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error?.message || 'An unexpected error occurred'}</Text>
          <TouchableOpacity style={styles.button} onPress={this.handleRetry}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: PAPER_THEME.surface.base,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: PAPER_THEME.text.primary,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: PAPER_THEME.text.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: PAPER_THEME.brand.default,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: PAPER_THEME.utility.white,
  },
});
