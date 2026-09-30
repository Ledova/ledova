function required(name, pattern) {
  const value = process.env[name];
  if (!value || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`Set a valid ${name} for the iOS release build.`);
  }
  return value;
}

module.exports = ({ config }) => {
  if (!process.env.LEDOVA_IOS_RELEASE) return config;
  if (process.env.LEDOVA_IOS_RELEASE !== '1' || process.env.EXPO_NO_DOTENV !== '1') {
    throw new Error('Set LEDOVA_IOS_RELEASE=1 and EXPO_NO_DOTENV=1 for an explicit release environment.');
  }
  const bundleIdentifier = required('LEDOVA_IOS_BUNDLE_ID', /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/);
  if (bundleIdentifier === config.ios.bundleIdentifier) {
    throw new Error('Use the registered store bundle ID, not the development placeholder.');
  }
  const appleTeamId = required('LEDOVA_APPLE_TEAM_ID', /^[A-Z0-9]{10}$/);
  const version = required('LEDOVA_APP_VERSION', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const buildNumber = required('LEDOVA_IOS_BUILD_NUMBER', /^[1-9]\d{0,3}$/);
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_MARKETING_URL']) {
    const value = required(name, /^https:\/\/[^\s\\]+$/);
    const url = new URL(value);
    if (url.username || url.password || /[?#]/.test(value)) {
      throw new Error(`${name} must be an HTTPS URL without credentials, query or fragment.`);
    }
  }
  if (
    process.env.EXPO_PUBLIC_DEV_API_HOST ||
    Object.keys(process.env).some((name) => name.startsWith('EXPO_PUBLIC_NATIVE_PROBE_'))
  ) {
    throw new Error('Unset development hosts and native probes for an iOS release.');
  }
  return {
    ...config,
    version,
    ios: { ...config.ios, bundleIdentifier, appleTeamId, buildNumber },
  };
};
