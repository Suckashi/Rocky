// One-time login codes for the launch URL. The browser is a process Rocky starts, so it
// gets a short-lived single-use code, never the API token itself.
import { randomBytes } from 'node:crypto';
import { sameToken } from './token.ts';

export class LoginCodes {
  private codes = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 120_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  issue(): string {
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, this.now() + this.ttlMs);
    return code;
  }

  /** True once per valid, unexpired code. */
  redeem(supplied: string): boolean {
    for (const [code, expires] of this.codes) {
      if (expires < this.now()) {
        this.codes.delete(code);
        continue;
      }
      if (sameToken(code, supplied)) {
        this.codes.delete(code);
        return true;
      }
    }
    return false;
  }
}
