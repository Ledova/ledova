const fs = require('node:fs');
const path = require('node:path');
const {
  withAppDelegate,
  withInfoPlist,
  withXcodeProject,
  withFinalizedMod,
  IOSConfig,
} = require('expo/config-plugins');

const delegate = 'LedovaSceneDelegate';
const manifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: delegate },
    ],
  },
};
const launchWindow =
  /\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,/;

module.exports = function withSceneLifecycle(config) {
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift' || !launchWindow.test(config.modResults.contents)) {
      throw new Error(
        `${delegate} attaches the window AppDelegate creates at launch; review it against this AppDelegate.`,
      );
    }
    return config;
  });
  config = withInfoPlist(config, (config) => {
    const existing = config.modResults.UIApplicationSceneManifest;
    if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error(`Info.plist already declares another scene manifest; review it before using ${delegate}.`);
    }
    config.modResults.UIApplicationSceneManifest = manifest;
    return config;
  });
  config = withXcodeProject(config, (config) => {
    const name = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const filepath = `${name}/${delegate}.m`;
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project: config.modResults });
    }
    return config;
  });
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      fs.copyFileSync(
        path.join(__dirname, 'native', `${delegate}.m`),
        path.join(IOSConfig.Paths.getSourceRoot(config.modRequest.projectRoot), `${delegate}.m`),
      );
      return config;
    },
  ]);
};
