/** Decorative projected meridians: deterministic geometry, no WebGL or runtime loop. */
const MERIDIANS = Array.from({ length: 9 }, (_, index) => {
  const angle = index * Math.PI / 9;
  const points = Array.from({ length: 97 }, (_, step) => {
    const t = step * Math.PI * 2 / 96;
    const x = Math.cos(t) * Math.cos(angle);
    const y = Math.sin(t);
    const z = Math.cos(t) * Math.sin(angle);
    return `${200 + 142 * (x * .88 + z * .32)},${200 + 142 * (y * .88 - z * .38)}`;
  });
  return `M${points.join(' L')} Z`;
});

export function ResearchOrbit() {
  return (
    <div className="research-orbit" data-testid="research-orbit">
      <svg viewBox="0 0 400 400" width="400" height="400" fill="none" focusable="false">
        <g className="research-orbit-shell" stroke="currentColor" strokeWidth=".65">
          {MERIDIANS.map((path, index) => <path key={index} d={path} />)}
          <ellipse cx="200" cy="200" rx="178" ry="66" transform="rotate(-28 200 200)" strokeDasharray="2 7" />
        </g>
        <g className="research-orbit-electron">
          <circle cx="200" cy="200" r="28" fill="currentColor" fillOpacity=".05" />
          <circle cx="200" cy="200" r="22" stroke="currentColor" strokeWidth=".8" />
          <circle cx="346" cy="200" r="3" fill="currentColor" />
          <circle cx="80" cy="110" r="2" fill="currentColor" />
          <circle cx="254" cy="325" r="2.5" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
