// Roko, the mascot: one shared spritesheet (192 × 208 cells, 8 fps) from assets/roko.
import { useEffect, useState } from 'react';
import manifest from '../../../assets/roko/roko-manifest.json' with { type: 'json' };
import { useI18n, type MessageKey } from '../i18n/index.tsx';

export type RokoState = 'idle' | 'waving' | 'running' | 'failed' | 'waiting';

const { cellWidth, cellHeight, columns, rows } = manifest.grid;
const FPS = manifest.playback.suggestedStartingFps;

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

export function Roko({
  state = 'idle',
  size = 96,
}: {
  state?: RokoState;
  size?: number;
}) {
  const { t } = useI18n();
  const animation = manifest.animations[state];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (prefersReducedMotion()) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % animation.columns.length),
      1000 / FPS,
    );
    return () => clearInterval(timer);
  }, [animation]);
  const scale = size / cellWidth;
  const column = animation.columns[frame] ?? 0;
  return (
    <span
      role="img"
      aria-label={t(`roko.alt.${state}` as MessageKey)}
      className="roko"
      style={{
        width: size,
        height: Math.round(cellHeight * scale),
        backgroundImage: 'url(/roko/roko-spritesheet.png)',
        backgroundSize: `${columns * cellWidth * scale}px ${rows * cellHeight * scale}px`,
        backgroundPosition: `${-column * cellWidth * scale}px ${-animation.row * cellHeight * scale}px`,
      }}
    />
  );
}
