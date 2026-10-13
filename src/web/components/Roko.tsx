// Roko, the mascot: the spritesheet from assets/roko (192 × 208 cells, 8 fps), served one
// row per file so the first screen only waits for the row it shows (assets/roko/README.md).
import { useEffect, useRef, useState, type RefObject } from 'react';
import manifest from '../../../assets/roko/roko-manifest.json' with { type: 'json' };
import faces from '../../../assets/roko/roko-faces.json' with { type: 'json' };
import { useI18n, type MessageKey } from '../i18n/index.tsx';

export type RokoState =
  'idle' | 'waving' | 'running' | 'failed' | 'waiting' | 'done' | 'resting';

/** Sprite rows per state; a finished turn plays the jump. */
const ROW: Record<RokoState, keyof typeof manifest.animations> = {
  idle: 'idle',
  waving: 'waving',
  running: 'running',
  failed: 'failed',
  waiting: 'waiting',
  done: 'jumping',
  // Nothing to do yet: Roko dozes (the sheet's "review" row, eyes half closed).
  resting: 'review',
};

const { cellWidth, cellHeight, columns, rows } = manifest.grid;
const FPS = manifest.playback.suggestedStartingFps;
const LOOK = manifest.lookDirections;
/** States calm enough for Roko to turn towards the pointer; the others carry news. */
const CAN_LOOK = new Set<RokoState>(['idle', 'waving']);
/** The face crop for small sizes: a square this wide (cell px) around the visor. The visor
 *  moves from frame to frame (Roko jumps, leans, runs), so each cell has its own centre,
 *  measured from the artwork into roko-faces.json. */
const FACE_SPAN = 96;
/** The head sits a little above the visor's centre. */
const FACE_LIFT = 8;
function faceCentre(row: number, column: number): [number, number] {
  const cells = faces.cells as Record<string, (number[] | null)[]>;
  const centre = cells[String(row)]?.[column];
  return centre ? [centre[0]!, centre[1]!] : [cellWidth / 2, cellHeight * 0.65];
}
/** How long Roko keeps looking after the pointer stops. */
const LOOK_REST_MS = 2500;

type Cell = { row: number; column: number; mirrored?: boolean };

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

/** Where the caret sits in a text box, roughly: the end of the text before it on its line. */
let measure: CanvasRenderingContext2D | null | undefined;
function caretPoint(
  box: HTMLTextAreaElement | HTMLInputElement,
): [number, number] {
  const rect = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  measure ??= document.createElement('canvas').getContext('2d');
  const before = box.value.slice(0, box.selectionStart ?? box.value.length);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  let width = line.length * parseFloat(style.fontSize);
  if (measure) {
    measure.font = style.font;
    width = measure.measureText(line).width;
  }
  const left = rect.left + parseFloat(style.paddingLeft);
  return [
    Math.min(left + width, rect.right),
    rect.top + Math.min(rect.height / 2, 24),
  ];
}

/** The look frame pointing from Roko towards a mouse or pen, or towards the words being
 *  typed (Roko reads along), until it rests. */
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
    const aim = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = target.current?.getBoundingClientRect();
        if (!box) return;
        const dx = x - (box.left + box.width / 2);
        const dy = y - (box.top + box.height / 2);
        // Over Roko itself there is no direction to look in.
        if (Math.hypot(dx, dy) < box.width * 0.35) {
          setLook(undefined);
          return;
        }
        // 0° is up, clockwise, as the manifest's look frames are laid out.
        const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        const index = Math.round(angle / LOOK.stepDegrees) % LOOK.count;
        // The left-facing renders do not match the right-facing ones (visor and shading
        // differ), so Roko looks left with the right-facing frame, mirrored.
        const half = LOOK.count / 2;
        const mirrored = index > half;
        const next = LOOK.frames[mirrored ? LOOK.count - index : index];
        if (next)
          setLook((current) =>
            current?.row === next.row &&
            current.column === next.column &&
            !!current.mirrored === mirrored
              ? current
              : { row: next.row, column: next.column, mirrored },
          );
      });
      clearTimeout(rest);
      rest = setTimeout(() => setLook(undefined), LOOK_REST_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') aim(event.clientX, event.clientY);
    };
    const onInput = (event: Event) => {
      const box = event.target;
      if (
        box instanceof HTMLTextAreaElement ||
        (box instanceof HTMLInputElement && box.type === 'text')
      )
        aim(...caretPoint(box));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('input', onInput, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('input', onInput);
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
  face = false,
}: {
  state?: RokoState;
  size?: number;
  /** Turn towards the pointer while idle or waving. */
  follow?: boolean;
  /** Show only the visor and eyes, for small sizes where the whole body would not read. */
  face?: boolean;
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
  const cell: Cell = look ?? {
    row: animation.row,
    column: animation.columns[frame] ?? 0,
  };
  const scale = face ? size / FACE_SPAN : size / cellWidth;
  const [faceX, faceY] = face ? faceCentre(cell.row, cell.column) : [0, 0];
  const offsetX = face ? faceX - FACE_SPAN / 2 : 0;
  const offsetY = face ? faceY - FACE_LIFT - FACE_SPAN / 2 : 0;
  return (
    <span
      ref={element}
      role="img"
      aria-label={t(`roko.alt.${state}` as MessageKey)}
      className={face ? 'roko face' : 'roko'}
      style={{
        width: size,
        height: face ? size : Math.round(cellHeight * scale),
        backgroundImage: `url(${rowImage(cell.row)})`,
        backgroundSize: `${columns * cellWidth * scale}px ${cellHeight * scale}px`,
        backgroundPosition: `${-(cell.column * cellWidth + offsetX) * scale}px ${-offsetY * scale}px`,
        // Turns around its own axis; composes with any transform or scale on the element.
        rotate: cell.mirrored ? 'y 180deg' : undefined,
      }}
    />
  );
}
