// Opens a URL in the default browser with argv only (no shell string).
import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {
    // No browser available (for example a headless machine); the URL is printed anyway.
  });
  child.unref();
}
