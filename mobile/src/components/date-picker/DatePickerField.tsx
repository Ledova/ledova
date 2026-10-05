import React, { useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, Platform, Modal, type StyleProp, type ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles, overlayColors } from '../../contexts';
import { Action, useCardStyles } from '../Ledger';
import { ModalActions, useDialogInsets } from '../modal';

interface DatePickerFieldProps {
  label: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  fieldStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = 'DD/MM/YYYY',
  minimumDate,
  maximumDate,
  fieldStyle,
  disabled = false,
}: DatePickerFieldProps) {
  const theme = useAppTheme();
  const insets = useDialogInsets();
  const card = useCardStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.xs,
    },
    label: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.text.body,
      marginBottom: theme.spacing.xs,
    },
    input: {
      backgroundColor: theme.colors.surface.tertiary,
      borderColor: theme.colors.border.default,
      borderWidth: 1,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      height: 56,
    },
    inputText: {
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
      fontWeight: theme.fontWeight.medium,
      flex: 1,
    },
    placeholder: {
      color: theme.colors.text.muted,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: overlayColors.modal,
    },
    sheet: {
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      paddingBottom: insets.bottom + theme.spacing.md,
      backgroundColor: theme.colors.surface.raised,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: theme.colors.border.default,
      borderTopLeftRadius: theme.borderRadius.lg,
      borderTopRightRadius: theme.borderRadius.lg,
    },
    picker: {
      alignSelf: 'center',
    },
  }));
  const [show, setShow] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false);
    }

    if (event.type === 'set' && selectedDate) {
      onChange(selectedDate);
      if (Platform.OS === 'ios') {
        setShow(false);
      }
    } else if (event.type === 'dismissed') {
      setShow(false);
    }
  };

  const handleDone = () => {
    setShow(false);
  };

  const handleCancel = () => {
    setShow(false);
  };

  const handlePress = () => {
    if (!disabled) {
      setShow(true);
    }
  };

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatDate(value) : placeholder }}
        accessibilityState={{ disabled, expanded: show }}
        disabled={disabled}
        style={[styles.input, fieldStyle]}
        onPress={handlePress}
        onAccessibilityTap={handlePress}
      >
        <CalendarIcon size={theme.icon.sizes.md} color={theme.colors.text.subtle} weight={theme.icon.weights.regular} />
        <Text style={[styles.inputText, !value && styles.placeholder]}>{value ? formatDate(value) : placeholder}</Text>
      </Pressable>

      {Platform.OS === 'ios' ? (
        <Modal visible={show} transparent animationType="slide" onRequestClose={handleCancel}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={handleCancel} />
            <View style={styles.sheet} accessibilityViewIsModal>
              <Text accessibilityRole="header" style={card.title}>
                {label}
              </Text>
              <DateTimePicker
                style={styles.picker}
                value={value || new Date()}
                mode="date"
                display="spinner"
                onChange={handleChange}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                themeVariant="light"
              />
              <ModalActions>
                <Action label="Cancel" onPress={handleCancel} />
                <Action label="Done" primary onPress={handleDone} />
              </ModalActions>
            </View>
          </View>
        </Modal>
      ) : (
        show && (
          <DateTimePicker
            value={value || new Date()}
            mode="date"
            display="default"
            onChange={handleChange}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            themeVariant="light"
          />
        )
      )}
    </View>
  );
}
