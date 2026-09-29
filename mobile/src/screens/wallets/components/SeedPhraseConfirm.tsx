import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';

interface SeedPhraseConfirmProps {
  quizPositions: number[];
  quizAnswers: string[];
  quizError: string | null;
  onAnswerChange: (index: number, text: string) => void;
}

export function SeedPhraseConfirm({ quizPositions, quizAnswers, quizError, onAnswerChange }: SeedPhraseConfirmProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    quizItem: {
      gap: theme.spacing.xs,
    },
    quizLabel: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
  }));
  return (
    <View style={styles.container}>
      <Text style={text.muted}>Enter the following words to confirm you saved your recovery phrase</Text>

      {quizPositions.map((pos, i) => (
        <View key={pos} style={styles.quizItem}>
          <Text style={styles.quizLabel}>Word #{pos + 1}</Text>
          <TextInput
            style={text.field}
            value={quizAnswers[i]}
            onChangeText={(text) => onAnswerChange(i, text)}
            placeholder="Enter word"
            placeholderTextColor={theme.colors.text.subtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ))}

      {quizError && <Text style={text.error}>{quizError}</Text>}
    </View>
  );
}
