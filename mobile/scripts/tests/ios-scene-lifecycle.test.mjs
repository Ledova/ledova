import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { checkSceneProject } from '../ios-scene-project.mjs';

const mobile = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(mobile, 'package.json'));
const withSceneLifecycle = require(path.join(mobile, 'plugins/withSceneLifecycle.cjs'));
const plist = require('@expo/plist').default;

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

const generatedProject = (change = (project) => project) => {
  const delegate = fs.readFileSync(path.join(mobile, 'plugins/native/LedovaSceneDelegate.m'), 'utf8');
  const info = () => plist.parse(plist.build({ CFBundleName: 'Ledova', UIApplicationSceneManifest: manifest }));
  return change({
    plists: { 'Info.plist': info(), 'Info-Debug.plist': info() },
    generatedDelegate: delegate,
    pluginDelegate: delegate,
    sources: [
      'AppDelegate.swift in Sources',
      'LedovaSceneDelegate.m in Sources',
      'LedovaHTTPRequestHandler.m in Sources',
    ],
  });
};

test('the generated-project check passes a project the plugin produced', () => {
  checkSceneProject(generatedProject());
});

test('the generated-project check names a missing scene manifest instead of failing to parse it', () => {
  for (const file of ['Info.plist', 'Info-Debug.plist']) {
    const project = generatedProject((project) => {
      delete project.plists[file].UIApplicationSceneManifest;
      return project;
    });
    assert.throws(
      () => checkSceneProject(project),
      (error) =>
        error.name === 'AssertionError' &&
        error.message.startsWith(`${file} has no UIApplicationSceneManifest, so iOS 27 stops the app at launch`),
      file,
    );
  }
});

test('the generated-project check refuses another delegate, a stale or missing copy, and a delegate compiled twice', () => {
  const other = copy(manifest);
  other.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName = 'SceneDelegate';
  const cases = [
    [
      (project) => ({ ...project, plists: { ...project.plists, 'Info.plist': { UIApplicationSceneManifest: other } } }),
      /Info\.plist declares a scene manifest other than LedovaSceneDelegate's/,
    ],
    [
      (project) => ({ ...project, generatedDelegate: `${project.generatedDelegate}\n` }),
      /generated LedovaSceneDelegate\.m differs/,
    ],
    [(project) => ({ ...project, generatedDelegate: undefined }), /generated project has no LedovaSceneDelegate\.m/],
    [
      (project) => ({ ...project, sources: [...project.sources, 'LedovaSceneDelegate.m in Sources'] }),
      /compile LedovaSceneDelegate\.m exactly once/,
    ],
    [
      (project) => ({ ...project, sources: ['AppDelegate.swift in Sources'] }),
      /compile LedovaSceneDelegate\.m exactly once/,
    ],
  ];
  for (const [change, message] of cases) {
    assert.throws(() => checkSceneProject(generatedProject(change)), message);
  }
});

const incomingLink =
  /\bgetInitialURL\b|\baddEventListener\(\s*['"]url['"]|\buse(?:Linking)?URL\b|\blinking=\{|['"]expo-(?:linking|router)['"]/;

function appSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return appSources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test('the app reads no incoming links, because a link that cold-starts it never reaches getInitialURL', () => {
  const sources = [
    path.join(mobile, 'App.tsx'),
    path.join(mobile, 'index.ts'),
    ...appSources(path.join(mobile, 'src')),
  ];
  assert.ok(sources.length > 100);
  const readers = sources
    .filter((file) => incomingLink.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(mobile, file));
  assert.deepEqual(
    readers,
    [],
    'Under LedovaSceneDelegate a link that cold-starts the app reaches neither Linking.getInitialURL() nor a url listener; read docs/development/mobile-builds.md before handling incoming links.',
  );
  for (const call of [
    'Linking.getInitialURL().then(open);',
    "Linking.addEventListener('url', ({ url }) => open(url));",
    'const url = useURL();',
    '<NavigationContainer linking={linking}>',
    "import * as Linking from 'expo-linking';",
  ]) {
    assert.match(call, incomingLink, call);
  }
});
