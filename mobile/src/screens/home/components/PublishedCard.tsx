import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { NewspaperIcon } from 'phosphor-react-native';
import { PUBLICATION_COPY, usePublicationSummary } from '@ledova/shared';
import { Accordion } from '../../../components/accordion';
import { useThemedStyles } from '../../../contexts';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

export function PublishedCard() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { lines } = usePublicationSummary();
  const styles = useThemedStyles((theme) => ({
    content: {
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
    line: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    footer: {
      alignItems: 'flex-end',
      paddingTop: theme.spacing.sm,
      marginTop: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
    link: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.interactive.active,
    },
  }));

  if (lines.length === 0) return null;

  return (
    <Accordion title={PUBLICATION_COPY.LIST_TITLE} icon={<NewspaperIcon />}>
      <View style={styles.content}>
        {lines.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}
        <View style={styles.footer}>
          <TouchableOpacity
            accessibilityRole="link"
            onPress={() =>
              navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Publications' } } as never)
            }
          >
            <Text style={styles.link}>{PUBLICATION_COPY.SUMMARY_OPEN}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Accordion>
  );
}
