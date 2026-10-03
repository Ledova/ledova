const focusLine = /^(mCurrentFocus|mFocusedApp)=/;
const notResponding = /^mCurrentFocus=Window\{\S+ u\d+ Application Not Responding: ([^\s}]+)\}$/;

export function windowFocus(windows) {
  const lines = windows.split('\n').map((line) => line.trim());
  return { focus: [...new Set(lines.filter((line) => focusLine.test(line)))] };
}

export function refuseNotResponding({ focus = [] }, file) {
  const owner = focus.map((line) => line.match(notResponding)?.[1]).find(Boolean);
  if (owner) {
    throw new Error(
      `${file} was taken while a system Application Not Responding window for ${owner} held focus instead of the app: ${focus.join('; ')}.`,
    );
  }
}
