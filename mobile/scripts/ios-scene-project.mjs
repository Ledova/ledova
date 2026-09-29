import assert from 'node:assert/strict';

const delegate = 'LedovaSceneDelegate';
const manifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: delegate },
    ],
  },
};

export function checkSceneProject({ plists, generatedDelegate, pluginDelegate, sources }) {
  for (const [file, info] of Object.entries(plists)) {
    assert.ok(
      info.UIApplicationSceneManifest != null,
      `${file} has no UIApplicationSceneManifest, so iOS 27 stops the app at launch; prebuild with plugins/withSceneLifecycle.cjs.`,
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(info.UIApplicationSceneManifest)),
      manifest,
      `${file} declares a scene manifest other than ${delegate}'s.`,
    );
  }
  assert.ok(generatedDelegate !== undefined, `The generated project has no ${delegate}.m.`);
  assert.equal(
    generatedDelegate,
    pluginDelegate,
    `The generated ${delegate}.m differs from plugins/native/${delegate}.m.`,
  );
  assert.equal(
    sources.filter((name) => name === `${delegate}.m in Sources`).length,
    1,
    `The app target must compile ${delegate}.m exactly once.`,
  );
}
