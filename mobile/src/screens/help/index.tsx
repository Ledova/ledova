import React from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { EnvelopeSimpleIcon, InfoIcon, QuestionIcon, FileTextIcon } from 'phosphor-react-native';
import { useOperator } from '@ledova/shared';
import { GradientBackground } from '../../components/GradientBackground';
import { ContactCard } from './components/ContactCard';
import { PUBLIC_LINKS, SUPPORT_EMAIL } from '../../config/publicLinks';
import { useThemedStyles } from '../../contexts';
import appJson from '../../../app.json';

const APP_VERSION = appJson.expo.version;
const CURRENT_YEAR = new Date().getFullYear();

export function HelpScreen() {
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
    },
    contentContainer: {
      padding: theme.spacing.md,
      paddingBottom: theme.spacing.xxl,
    },
    cardsContainer: {
      gap: theme.spacing.md,
    },
    aboutContainer: {
      marginTop: theme.spacing.xs,
      gap: theme.spacing.xs,
    },
    aboutText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
    legalContainer: {
      marginTop: theme.spacing.xs,
      gap: theme.spacing.sm,
    },
    legalLink: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.info.light,
      fontWeight: theme.fontWeight.medium,
    },
  }));
  const { data: operator } = useOperator({ cache: 'body' });

  const handleEmailPress = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  };

  const handleVisitHelpCenter = () => {
    Linking.openURL(PUBLIC_LINKS.helpCenter);
  };

  const handleTermsOfService = () => {
    Linking.openURL(PUBLIC_LINKS.termsOfService);
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL(PUBLIC_LINKS.privacyPolicy);
  };

  return (
    <GradientBackground>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.cardsContainer}>
          {SUPPORT_EMAIL ? (
            <ContactCard
              icon={<EnvelopeSimpleIcon />}
              title="Deployment Support"
              description="Contact the support channel configured by this deployment's owner."
              actionLabel={SUPPORT_EMAIL}
              onAction={handleEmailPress}
            />
          ) : null}

          <ContactCard
            icon={<QuestionIcon />}
            title="Help Center"
            description="Browse the reference documentation served by the configured public site."
            actionLabel="Visit Help Center"
            onAction={handleVisitHelpCenter}
          />

          <ContactCard icon={<FileTextIcon />} title="Legal" description="Review our terms and policies.">
            <View style={styles.legalContainer}>
              <Text style={styles.legalLink} onPress={handleTermsOfService}>
                Terms of Service
              </Text>
              <Text style={styles.legalLink} onPress={handlePrivacyPolicy}>
                Privacy Policy
              </Text>
            </View>
          </ContactCard>

          <ContactCard icon={<InfoIcon />} title="About" description="">
            <View style={styles.aboutContainer}>
              {operator?.name ? <Text style={styles.aboutText}>Operated by {operator.name}</Text> : null}
              <Text style={styles.aboutText}>Version {APP_VERSION}</Text>
              <Text style={styles.aboutText}>© {CURRENT_YEAR} Ledova contributors</Text>
              <Text style={styles.aboutText}>Licensed under Ledova Noncommercial License 1.0.</Text>
            </View>
          </ContactCard>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}
