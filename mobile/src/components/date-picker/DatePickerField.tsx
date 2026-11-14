import React, { useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, Platform, Modal, Keyboard } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles, overlayColors } from '../../contexts';
import { Action, useCardStyles } from '../Ledger';
import { ModalActions, useDialogInsets } from '../modal';
import { useControlFrame } from '../Input';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

interface DatePickerFieldProps {
  label: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  error?: string | null;
}

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = 'DD/MM/YYYY',
  minimumDate,
  maximumDate,
  disabled = false,
  error,
}: DatePickerFieldProps) {
  const theme = useAppTheme();
  const insets = useDialogInsets();
  const card = useCardStyles();
  const form = useCompanyStyles();
  const frame = useControlFrame();
  const styles = useThemedStyles((theme) => ({
    value: { flex: 1 },
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
      Keyboard.dismiss();
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
    <View style={[form.group, form.filledGroup]}>
      <Text style={form.filledLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatDate(value) : placeholder }}
        accessibilityState={{ disabled, expanded: show }}
        disabled={disabled}
        accessibilityHint={error ?? undefined}
        style={[frame.frame, frame.filled, !!error && frame.invalid]}
        onPress={handlePress}
        onAccessibilityTap={handlePress}
      >
        <CalendarIcon size={theme.icon.sizes.md} color={theme.colors.text.subtle} weight={theme.icon.weights.regular} />
        <Text style={[frame.text, styles.value, !value && frame.placeholder]}>
          {value ? formatDate(value) : placeholder}
        </Text>
      </Pressable>
      {!!error && <Text style={form.error}>{error}</Text>}

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
                themeVariant={theme.mode === 'dark' ? 'dark' : 'light'}
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
            themeVariant={theme.mode === 'dark' ? 'dark' : 'light'}
          />
        )
      )}
    </View>
  );
}
