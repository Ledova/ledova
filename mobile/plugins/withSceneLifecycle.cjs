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
const appDelegateClass =
  /^[ \t]*(?:(?:public|open|internal|final)[ \t]+)*class AppDelegate: ExpoAppDelegate\b[^{\n]*\{/m;
const objcWindow =
  /^[ \t]*(?:@objc[ \t]+)?(?:(?:private|fileprivate|internal|public|open)[ \t]+)?var window: UIWindow[?!](?:[ \t]*=[ \t]*nil)?[ \t]*$/m;

function classBody(source, declaration) {
  let depth = 0;
  for (let index = declaration.index + declaration[0].length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(declaration.index, index + 1);
  }
  return '';
}

module.exports = function withSceneLifecycle(config) {
  config = withAppDelegate(config, (config) => {
    const source = config.modResults.contents;
    if (config.modResults.language !== 'swift' || !launchWindow.test(source)) {
      throw new Error(
        `${delegate} attaches the window AppDelegate creates at launch; review it against this AppDelegate.`,
      );
    }
    const declaration = appDelegateClass.exec(source);
    if (!declaration || !objcWindow.test(classBody(source, declaration))) {
      throw new Error(
        `${delegate} reads AppDelegate's window through Objective-C: AppDelegate must subclass ExpoAppDelegate and store var window: UIWindow? without @nonobjc, weak, static or let.`,
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
