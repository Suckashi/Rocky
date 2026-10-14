// Code the user may want to paste elsewhere: a copy button that shows on hover or focus.
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';

/** A code block with a copy button that shows on hover or focus. */
export function CodeBlock({
  children,
  inline = false,
}: {
  children?: ReactNode;
  /** A one-line command shown as code in running text, not a fenced block. */
  inline?: boolean;
}) {
  const { t } = useI18n();
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className={`code-block${inline ? ' inline' : ''}`}>
      <pre ref={pre}>{children}</pre>
      <button
        type="button"
        className={`copy${copied ? ' copied' : ''}`}
        aria-label={t(copied ? 'chat.copied' : 'chat.copy')}
        title={t(copied ? 'chat.copied' : 'chat.copy')}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(pre.current?.textContent ?? '')
            .then(() => setCopied(true))
            .catch(() => undefined)
        }
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
