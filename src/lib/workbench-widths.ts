export function fitWorkbenchWidths(container: number, left: number, right: number, leftCollapsed = false, rightCollapsed = false) {
  const bounded = (value: number, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
  const preferredLeft = leftCollapsed ? 0 : bounded(left, 320, 260, 450);
  const preferredRight = rightCollapsed ? 0 : bounded(right, 380, 280, 650);
  const available = Math.max(0, container - 360 - 12);
  const total = preferredLeft + preferredRight;
  const ratio = total > available ? available / total : 1;
  return { left: Math.floor(preferredLeft * ratio), right: Math.floor(preferredRight * ratio) };
}
