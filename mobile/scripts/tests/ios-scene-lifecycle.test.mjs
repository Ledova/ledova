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

const sdk54AppDelegate = `public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
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
