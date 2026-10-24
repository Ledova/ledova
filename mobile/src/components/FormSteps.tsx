import { Text, View } from 'react-native';
import { useThemedStyles } from '../contexts';

export function FormSteps({ steps, current }: { steps: readonly { id: string; label: string }[]; current: string }) {
  const styles = useThemedStyles((theme) => ({
    list: { flexDirection: 'row' as const, gap: theme.spacing.smd },
    step: {
      flex: 1,
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.smd,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.border.subtle,
    },
    currentStep: { borderBottomColor: theme.colors.brand.mid },
    number: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: theme.colors.surface.tertiary,
    },
    currentNumber: { backgroundColor: theme.colors.brand.mid },
    numberText: { fontFamily: theme.fontFamily.medium, fontSize: 12, color: theme.colors.text.muted },
    currentNumberText: { color: theme.colors.utility.white },
    stepLabel: { fontFamily: theme.fontFamily.medium, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
    currentLabel: { color: theme.colors.text.primary },
  }));
  return (
    <View style={styles.list}>
      {steps.map((step, index) => {
        const active = step.id === current;
        return (
          <View
            key={step.id}
            accessible
            accessibilityLabel={`Step ${index + 1} of ${steps.length}: ${step.label}`}
            accessibilityState={{ selected: active }}
            style={[styles.step, active && styles.currentStep]}
          >
            <View style={[styles.number, active && styles.currentNumber]}>
              <Text style={[styles.numberText, active && styles.currentNumberText]}>{index + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, active && styles.currentLabel]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
