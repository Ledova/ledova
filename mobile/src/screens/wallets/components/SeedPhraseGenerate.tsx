import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Choice } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';

type InputMode = 'create' | 'import';

interface SeedPhraseGenerateProps {
  inputMode: InputMode;
  words: string[];
  importWords: string[];
  importError: string | null;
  onInputModeChange: (mode: InputMode) => void;
  onImportWordChange: (index: number, value: string) => void;
}

export function SeedPhraseGenerate({
  inputMode,
  words,
  importWords,
  importError,
  onInputModeChange,
  onImportWordChange,
}: SeedPhraseGenerateProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    modes: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: theme.spacing.sm,
    },
    word: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '48%',
      gap: theme.spacing.sm,
    },
    wordIndex: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
      minWidth: 18,
    },
    wordText: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
    },
    importInput: {
      flex: 1,
      paddingVertical: theme.spacing.sm,
      fontSize: theme.fontSize.sm,
    },
  }));
  return (
    <View style={styles.container}>
      <Text style={text.muted}>
        {inputMode === 'create' ? 'Your recovery phrase' : 'Enter your 12-word recovery phrase'}
      </Text>

      <View style={styles.modes}>
        <Choice label="New" selected={inputMode === 'create'} onPress={() => onInputModeChange('create')} />
        <Choice label="Import" selected={inputMode === 'import'} onPress={() => onInputModeChange('import')} />
      </View>

      {inputMode === 'create' ? (
        <View style={styles.grid}>
          {words.map((word, index) => (
            <View key={index} style={styles.word}>
              <Text style={styles.wordIndex}>{index + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            {importWords.map((word, index) => (
              <View key={index} style={styles.word}>
                <Text style={styles.wordIndex}>{index + 1}</Text>
                <TextInput
                  style={[text.field, styles.importInput]}
                  value={word}
                  onChangeText={(text) => onImportWordChange(index, text)}
                  placeholder="word"
                  placeholderTextColor={theme.colors.text.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
          </View>
          {importError && <Text style={text.error}>{importError}</Text>}
        </>
      )}
    </View>
  );
}
