// Imported first by main.tsx, before any dependency builds its schemas. Rocky's CSP forbids
// eval, so zod's compiled fast path could never run; saying so up front stops zod from
// probing with Function(''), which the browser reports as a CSP violation. See ADR 0038.
import { config } from 'zod';

config({ jitless: true });
