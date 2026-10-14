// Stands in for `streamdown` in the web build. CopilotKit's provider module imports it only
// for its own chat components (CopilotChat*), which Rocky never renders; the real package
// brings KaTeX, parse5 and more into the first script. Should one ever render, it shows the
// text as is. See ADR 0038.
import type { ReactNode } from 'react';

export function Streamdown({ children }: { children?: ReactNode }) {
  return <div style={{ whiteSpace: 'pre-wrap' }}>{children}</div>;
}
