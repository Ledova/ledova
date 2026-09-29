import path from 'node:path';

export function borrowedModule(mobile, file, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const target = path.resolve(path.dirname(file), specifier);
  const climb = path.relative(mobile, target);
  const outside = climb === '..' || climb.startsWith(`..${path.sep}`) || path.isAbsolute(climb);
  return outside && climb.split(path.sep).includes('node_modules') ? target : null;
}
