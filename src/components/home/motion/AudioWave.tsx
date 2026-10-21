/** Illustrative waveform, not a microphone or fabricated live recording signal. */
const HEIGHTS = [8, 14, 24, 12, 30, 18, 26, 10, 22, 32, 16, 26, 12, 20, 8];
export function AudioWave() {
  return <span className="research-audio-wave" aria-hidden="true" data-testid="research-audio-wave">{HEIGHTS.map((height, index) => <span key={index} style={{ height, animationDelay: `${index * -.13}s` }} />)}</span>;
}
