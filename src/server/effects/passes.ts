// Second line of defence: the functions that write files or run commands accept only a pass
// the gate issued for exactly that content. A pass works once.
import { randomUUID } from 'node:crypto';

export interface Pass {
  readonly id: string;
  readonly contentHash: string;
  readonly receiptId: string;
}

export class PassBook {
  private readonly open = new Map<string, Pass>();

  issue(contentHash: string, receiptId: string): Pass {
    const pass = Object.freeze({ id: randomUUID(), contentHash, receiptId });
    this.open.set(pass.id, pass);
    return pass;
  }

  /** Passes issued and not yet used. */
  get outstanding(): number {
    return this.open.size;
  }

  /** Consumes the pass if it was issued here, is unused and matches the content. */
  redeem(pass: Pass, contentHash: string): void {
    const issued = this.open.get(pass.id);
    if (!issued || issued !== pass) throw new Error('pass-unknown-or-used');
    this.open.delete(pass.id);
    if (issued.contentHash !== contentHash)
      throw new Error('pass-content-mismatch');
  }
}
