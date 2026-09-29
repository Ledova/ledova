import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const mobile = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(mobile, 'package.json'));
const withSceneLifecycle = require(path.join(mobile, 'plugins/withSceneLifecycle.cjs'));

const manifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'LedovaSceneDelegate' },
    ],
  },
};

const copy = (value) => JSON.parse(JSON.stringify(value));

const sdk54AppDelegate = `import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

const sceneOwnedWindow = sdk54AppDelegate.replace(
  /#if os\(iOS\)[\s\S]*?#endif\n/,
  '    reactNativeFactory = factory\n',
);

function infoPlist(contents) {
  const config = withSceneLifecycle({ name: 'Ledova', slug: 'ledova' });
  return config.mods.ios.infoPlist({ ...config, modResults: contents, modRequest: {} });
}

function appDelegate(contents, language = 'swift') {
  const config = withSceneLifecycle({ name: 'Ledova', slug: 'ledova' });
  return config.mods.ios.appDelegate({ ...config, modResults: { contents, language }, modRequest: {} });
}

test('the scene manifest names the scene delegate and keeps the rest of Info.plist', async () => {
  const result = await infoPlist({ CFBundleName: 'Ledova', UIUserInterfaceStyle: 'Light' });
  assert.deepEqual(result.modResults, {
    CFBundleName: 'Ledova',
    UIUserInterfaceStyle: 'Light',
    UIApplicationSceneManifest: manifest,
  });
  assert.deepEqual(result.ios.infoPlist, result.modResults);
});

test('a second prebuild keeps the manifest and another scene manifest is refused', async () => {
  const first = await infoPlist({ CFBundleName: 'Ledova' });
  const second = await infoPlist(copy(first.modResults));
  assert.deepEqual(second.modResults, first.modResults);
  const expoSceneDelegate = copy(manifest);
  expoSceneDelegate.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName =
    '$(PRODUCT_MODULE_NAME).SceneDelegate';
  await assert.rejects(
    infoPlist({ UIApplicationSceneManifest: expoSceneDelegate }),
    /already declares another scene manifest/,
  );
});

test('the plugin accepts the AppDelegate that creates the window and starts React Native at launch', async () => {
  const result = await appDelegate(sdk54AppDelegate);
  assert.equal(result.modResults.contents, sdk54AppDelegate);
});

test('an AppDelegate that leaves the window to a scene delegate, or is not Swift, is refused', async () => {
  const message = /attaches the window AppDelegate creates at launch/;
  await assert.rejects(appDelegate(sceneOwnedWindow), message);
  await assert.rejects(appDelegate(sdk54AppDelegate, 'objcpp'), message);
});

const windowDeclaration = '  var window: UIWindow?\n';
const declaringWindow = (declaration) => sdk54AppDelegate.replace(windowDeclaration, `  ${declaration}\n`);

test('window declarations that Swift still exposes to Objective-C are accepted', async () => {
  for (const declaration of [
    'private var window: UIWindow?',
    'fileprivate var window: UIWindow?',
    '@objc public var window: UIWindow?',
    'weak var window: UIWindow?',
    'var window: UIWindow!',
  ]) {
    const source = declaringWindow(declaration);
    assert.notEqual(source, sdk54AppDelegate);
    assert.equal((await appDelegate(source)).modResults.contents, source, declaration);
  }
});

test('an AppDelegate whose window Objective-C cannot read is refused', async () => {
  const message = /reads AppDelegate's window through Objective-C/;
  for (const declaration of [
    '@nonobjc var window: UIWindow?',
    'static var window: UIWindow?',
    'let window: UIWindow? = nil',
    'var window: UIWindow? { nil }',
    'var mainWindow: UIWindow?',
  ]) {
    await assert.rejects(appDelegate(declaringWindow(declaration)), message, declaration);
  }
  const onAnotherClass = sdk54AppDelegate
    .replace(windowDeclaration, '')
    .replace(
      'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n',
      `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n${windowDeclaration}`,
    );
  assert.notEqual(onAnotherClass, sdk54AppDelegate);
  await assert.rejects(appDelegate(onAnotherClass), message);
  const notExpo = sdk54AppDelegate.replace(
    'public class AppDelegate: ExpoAppDelegate {',
    'public class AppDelegate: UIResponder, UIApplicationDelegate {',
  );
  assert.notEqual(notExpo, sdk54AppDelegate);
  await assert.rejects(appDelegate(notExpo), message);
});
