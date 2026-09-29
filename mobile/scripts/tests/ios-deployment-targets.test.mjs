import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const mobile = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(mobile, 'package.json'));
const withMobileSecurity = require(path.join(mobile, 'plugins/withMobileSecurity.cjs'));
const helper = path.join(mobile, 'plugins/native/deployment-targets.rb');

function raised(platforms, targets) {
  const script = `require 'json'
require ARGV.fetch(0)
Platform = Struct.new(:deployment_target)
Definition = Struct.new(:platform)
Podfile = Struct.new(:target_definition_list)
Configuration = Struct.new(:name, :build_settings)
Target = Struct.new(:name, :build_configurations)
Project = Struct.new(:targets)
Installer = Struct.new(:pods_project, :podfile)
input = JSON.parse(STDIN.read)
definitions = input.fetch('platforms').map { |value| Definition.new(value.nil? ? nil : Platform.new(value)) }
targets = input.fetch('targets').map do |target|
  configurations = target.fetch('configurations').map { |c| Configuration.new(c.fetch('name'), c.fetch('settings')) }
  Target.new(target.fetch('name'), configurations)
end
installer = Installer.new(Project.new(targets), Podfile.new(definitions))
2.times { LedovaDeploymentTargets.raise_to_podfile_platform(installer) }
puts JSON.generate(targets.map do |target|
  { name: target.name, configurations: target.build_configurations.map do |c|
    { name: c.name, settings: c.build_settings }
  end }
end)
`;
  const input = JSON.stringify({ platforms, targets });
  return JSON.parse(execFileSync('ruby', ['-e', script, helper], { input, timeout: 10000 }));
}

function target(name, deploymentTarget, extra = {}) {
  const settings = { ...extra };
  if (deploymentTarget !== null) settings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
  return {
    name,
    configurations: [
      { name: 'Debug', settings: { ...settings } },
      { name: 'Release', settings: { ...settings } },
    ],
  };
}

async function podfile(contents) {
  const config = withMobileSecurity({ name: 'Ledova', slug: 'ledova' });
  const result = await config.mods.ios.podfile({ ...config, modResults: { contents }, modRequest: {} });
  return result.modResults.contents;
}

test('pods below the Podfile platform rise to it and the rest keep their targets', () => {
  const svg = target('RNSVG-RNSVGFilters', '12.4', { PRODUCT_NAME: 'RNSVGFilters' });
  const storage = target('RNCAsyncStorage-RNCAsyncStorage_resources', '13.4');
  const single = target('SingleDigitPod', '9.0');
  const equal = target('EqualPod', '15.1');
  const newer = target('NewerPod', '16.0');
  const unset = target('NoTargetPod', null, { SKIP_INSTALL: 'YES' });
  assert.deepEqual(raised([null, '15.1'], [svg, storage, single, equal, newer, unset]), [
    target('RNSVG-RNSVGFilters', '15.1', { PRODUCT_NAME: 'RNSVGFilters' }),
    target('RNCAsyncStorage-RNCAsyncStorage_resources', '15.1'),
    target('SingleDigitPod', '15.1'),
    equal,
    newer,
    unset,
  ]);
});

test('the highest declared platform wins and a Podfile without one changes nothing', () => {
  const pod = target('Pod', '12.4');
  assert.deepEqual(raised(['15.1', '16.4'], [pod]), [target('Pod', '16.4')]);
  assert.deepEqual(raised([null], [pod]), [pod]);
  assert.deepEqual(raised([], [pod]), [pod]);
});

test('the Podfile hook installs the deployment floor beside the codegen correction, once', async () => {
  const original = 'target "Ledova" do\n  post_install do |installer|\n    existing_hook(installer)\n  end\nend\n';
  const first = await podfile(original);
  const second = await podfile(first);
  assert.equal(first, second);
  assert.equal(first.match(/deployment-targets/g).length, 1);
  assert.match(
    first,
    /LedovaCodegen\.remove_directory_input\(installer\)\n\s*require_relative '\.\.\/plugins\/native\/deployment-targets'\n\s*LedovaDeploymentTargets\.raise_to_podfile_platform\(installer\)\n[\s\S]*existing_hook\(installer\)/,
  );
  execFileSync('ruby', ['-c'], { input: first, timeout: 10000 });
});
