/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const workspacePackages = path.resolve(__dirname, '../packages');

config.watchFolders = [workspacePackages];

const mobileCopies = Object.fromEntries(
  Object.keys(require('./package.json').dependencies ?? {}).map((name) => [
    name,
    path.resolve(__dirname, 'node_modules', name),
  ]),
);

config.resolver.extraNodeModules = mobileCopies;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sharedPeer = /^(react|@tanstack\/react-query)(\/.*)?$/.test(moduleName);
  return context.resolveRequest(
    sharedPeer ? { ...context, originModulePath: path.join(__dirname, 'index.ts') } : context,
    moduleName,
    platform,
  );
};

module.exports = config;
