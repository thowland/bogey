// Whether Tab (step 1) or Shift+Tab (step -1) from `from` would leave the page's controls (F6).
// Native radio buttons with one name form a single tab stop, so a radio counts as the last stop
// when every control after it belongs to the same group (and likewise backwards).

/** The page's enabled controls in DOM (tab) order. */
export const tabbable = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-field-control]')].filter(
    (el) => !(el as HTMLInputElement).disabled,
  );

const sameGroup = (a: HTMLElement, b: HTMLElement) =>
  a instanceof HTMLInputElement &&
  b instanceof HTMLInputElement &&
  a.type === 'radio' &&
  b.type === 'radio' &&
  a.name === b.name;

export function leavesPage(root: HTMLElement, from: HTMLElement, step: 1 | -1): boolean {
  const controls = tabbable(root);
  const index = controls.indexOf(from);
  if (index === -1) return false;
  const rest = step === 1 ? controls.slice(index + 1) : controls.slice(0, index);
  return rest.every((el) => sameGroup(el, from));
}
