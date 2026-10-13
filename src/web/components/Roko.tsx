// Roko, the mascot: the spritesheet from assets/roko (192 × 208 cells, 8 fps), served one
// row per file so the first screen only waits for the row it shows (assets/roko/README.md).
import { useEffect, useRef, useState, type RefObject } from 'react';
import manifest from '../../../assets/roko/roko-manifest.json' with { type: 'json' };
import { useI18n, type MessageKey } from '../i18n/index.tsx';

export type RokoState =
  'idle' | 'waving' | 'running' | 'failed' | 'waiting' | 'done';

/** Sprite rows per state; a finished turn plays the jump. */
const ROW: Record<RokoState, keyof typeof manifest.animations> = {
  idle: 'idle',
  waving: 'waving',
  running: 'running',
  failed: 'failed',
  waiting: 'waiting',
  done: 'jumping',
};

const { cellWidth, cellHeight, columns, rows } = manifest.grid;
const FPS = manifest.playback.suggestedStartingFps;
const LOOK = manifest.lookDirections;
/** States calm enough for Roko to turn towards the pointer; the others carry news. */
const CAN_LOOK = new Set<RokoState>(['idle', 'waving']);
/** How long Roko keeps looking after the pointer stops. */
const LOOK_REST_MS = 2500;

type Cell = { row: number; column: number };

const rowImage = (row: number) => `/roko/rows/roko-row-${row}.webp`;

/** Once the page is idle, fetch every row so a change of state never waits on the network. */
let warmed = false;
function warmRows() {
  if (warmed) return;
  warmed = true;
  const load = () => {
    for (let row = 0; row < rows; row++) new Image().src = rowImage(row);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load);
  else setTimeout(load, 1000);
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

/** The look frame pointing from Roko towards a mouse or pen, until it rests. */
function useLook(
  enabled: boolean,
  target: RefObject<HTMLElement | null>,
): Cell | undefined {
  const [look, setLook] = useState<Cell>();
  useEffect(() => {
    setLook(undefined);
    if (!enabled) return;
    let frame = 0;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = target.current?.getBoundingClientRect();
        if (!box) return;
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        // Over Roko itself there is no direction to look in.
        if (Math.hypot(dx, dy) < box.width * 0.35) {
          setLook(undefined);
          return;
        }
        // 0° is up, clockwise, as the manifest's look frames are laid out.
        const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        const index = Math.round(angle / LOOK.stepDegrees) % LOOK.count;
        const next = LOOK.frames[index];
        if (next)
          setLook((current) =>
            current?.row === next.row && current.column === next.column
              ? current
              : { row: next.row, column: next.column },
          );
      });
      clearTimeout(rest);
      rest = setTimeout(() => setLook(undefined), LOOK_REST_MS);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
      clearTimeout(rest);
    };
  }, [enabled, target]);
  return look;
}

export function Roko({
  state = 'idle',
  size = 96,
  follow = false,
}: {
  state?: RokoState;
  size?: number;
  /** Turn towards the pointer while idle or waving. */
  follow?: boolean;
}) {
  const { t } = useI18n();
  const animation = manifest.animations[ROW[state]];
  const [frame, setFrame] = useState(0);
  const element = useRef<HTMLSpanElement>(null);
  const look = useLook(follow && CAN_LOOK.has(state), element);
  useEffect(warmRows, []);
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
  const cell: Cell = look ?? {
    row: animation.row,
    column: animation.columns[frame] ?? 0,
  };
  return (
    <span
      ref={element}
      role="img"
      aria-label={t(`roko.alt.${state}` as MessageKey)}
      className="roko"
      style={{
        width: size,
        height: Math.round(cellHeight * scale),
        backgroundImage: `url(${rowImage(cell.row)})`,
        backgroundSize: `${columns * cellWidth * scale}px ${cellHeight * scale}px`,
        backgroundPosition: `${-cell.column * cellWidth * scale}px 0px`,
      }}
    />
  );
}
