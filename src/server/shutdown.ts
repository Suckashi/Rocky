// Graceful shutdown with a deadline. Adapted from OpenDots' createShutdown (MIT).
export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export function createShutdown(options: {
  steps: ShutdownStep[];
  exit: (code: number) => void;
  report: (step: string, error: unknown) => void;
  timeoutMs?: number;
}): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () =>
    (pending ??= (async () => {
      let failed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          failed = true;
          options.report('deadline', new Error('shutdown took too long'));
          resolve();
        }, options.timeoutMs ?? 8000);
      });
      const all = Promise.all(
        options.steps.map(async (step) => {
          try {
            await step.run();
          } catch (error) {
            failed = true;
            options.report(step.name, error);
          }
        }),
      );
      await Promise.race([all, deadline]);
      clearTimeout(timer);
      options.exit(failed ? 1 : 0);
    })());
}
