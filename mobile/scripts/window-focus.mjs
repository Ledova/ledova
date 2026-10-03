const focusLine = /^(mCurrentFocus|mFocusedApp)=/;
const notResponding = /^mCurrentFocus=Window\{\S+ u\d+ Application Not Responding: ([^\s}]+)\}$/;

export function windowFocus(displays) {
  const lines = displays.split('\n').map((line) => line.trim());
  return { focus: [...new Set(lines.filter((line) => focusLine.test(line)))] };
}

export function checkFocus({ focus }, file) {
  if (focus === undefined) return;
  if (!focus.some((line) => line.startsWith('mCurrentFocus='))) {
    throw new Error(`${file} could not be checked: the window dump has no mCurrentFocus line, so focus is unknown.`);
  }
  const owner = focus.map((line) => line.match(notResponding)?.[1]).find(Boolean);
  if (owner) {
    throw new Error(
      `${file} was taken while a system Application Not Responding window for ${owner} held focus instead of the app: ${focus.join('; ')}.`,
    );
  }
}
