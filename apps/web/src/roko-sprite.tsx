import { useEffect, useRef, useState } from "react";
import {
  rokoFrame,
  rokoManifest,
  type RokoPlayback,
} from "./roko-animation.js";

// Every instance shares one fetched/decoded local atlas. A failed load stays failed
// for this page lifetime; remounts never create a retry storm.
let atlas: Promise<HTMLImageElement> | undefined;
function loadAtlas() {
  return (atlas ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth !== rokoManifest.image.width ||
        image.naturalHeight !== rokoManifest.image.height
      )
        reject(Error("Roko atlas dimensions do not match the manifest"));
      else image.decode().then(() => resolve(image), reject);
    };
    image.onerror = () => reject(Error("Roko atlas unavailable"));
    image.src = `/roko/${rokoManifest.image.file}`;
  }));
}

export function RokoSprite({
  clip = "idle",
  mode = "static",
  width = 50,
  className = "",
  playbackId = "",
}: Partial<RokoPlayback> & {
  width?: number;
  className?: string;
  playbackId?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const height =
    (width * rokoManifest.grid.cellHeight) / rokoManifest.grid.cellWidth;
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) {
      setFailed(true);
      return;
    }
    let disposed = false,
      visible = false,
      image: HTMLImageElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let elapsed = 0,
      started = 0;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const draw = (time: number, playback: RokoPlayback["mode"]) => {
      if (!image) return;
      const frame = rokoFrame(clip, time, playback);
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(
        image,
        frame.x,
        frame.y,
        rokoManifest.grid.cellWidth,
        rokoManifest.grid.cellHeight,
        0,
        0,
        target.width,
        target.height,
      );
      target.dataset.frame = `${frame.row}:${frame.column}`;
      target.dataset.loaded = "true";
    };
    const stop = () => {
      if (started) elapsed += performance.now() - started;
      started = 0;
      clearTimeout(timer);
      target.dataset.playing = "false";
    };
    const tick = () => {
      if (disposed) return;
      const time = elapsed + performance.now() - started;
      draw(time, mode);
      const duration =
        (rokoManifest.animations[clip].columns.length /
          rokoManifest.playback.suggestedStartingFps) *
        1000;
      if (mode === "once" && time >= duration) {
        stop();
        return;
      }
      timer = setTimeout(
        tick,
        1000 / rokoManifest.playback.suggestedStartingFps,
      );
    };
    const sync = () => {
      stop();
      if (!image) return;
      const animate =
        mode !== "static" && visible && !document.hidden && !media.matches;
      draw(elapsed, media.matches ? "static" : mode);
      if (animate) {
        started = performance.now();
        target.dataset.playing = "true";
        tick();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !image)
        void loadAtlas().then(
          (loaded) => {
            if (disposed) return;
            image = loaded;
            sync();
          },
          () => {
            if (!disposed) setFailed(true);
          },
        );
      sync();
    });
    observer.observe(target);
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [clip, mode, playbackId]);
  return failed ? (
    <span
      className={`roko-sprite ${className}`}
      role="img"
      aria-label="Roko"
      style={{ width, height }}
    >
      Roko
    </span>
  ) : (
    <canvas
      ref={canvas}
      className={`roko-sprite ${className}`}
      role="img"
      aria-label="Roko"
      width={rokoManifest.grid.cellWidth}
      height={rokoManifest.grid.cellHeight}
      style={{ width, height }}
      data-clip={clip}
      data-mode={mode}
    >
      Roko
    </canvas>
  );
}
