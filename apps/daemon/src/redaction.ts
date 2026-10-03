const secretKey =
  /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|client[-_]?secret)$/i;
const marker = "[REDACTED]";
/** Hold a tail across deltas so configured credentials cannot leak when split by SSE frames. */
export function createTextStreamRedactor(secrets: readonly string[]) {
  const window = 32 + Math.max(0, ...secrets.map((secret) => secret.length));
  let raw = "",
    emitted = "";
  return (text: string, final = false) => {
    raw += text;
    if (raw.length > 1048576) throw Error("Stream text limit");
    // Structured text must be whole before field redaction/serialization is stable.
    if (!final && /^[\s]*[\[{]/.test(raw)) return "";
    let length = final ? raw.length : Math.max(0, raw.length - window);
    const pendingUrl = /https?:\/\/\S*$/i.exec(raw);
    if (!final && pendingUrl) length = Math.min(length, pendingUrl.index);
    // Cut in original text coordinates, never inside a complete credential match.
    for (const secret of secrets.filter(Boolean)) {
      const start = raw.lastIndexOf(secret, length);
      if (start >= 0 && start < length && start + secret.length > length)
        length = start;
    }
    const safe = String(redactEvidence(raw.slice(0, length), secrets));
    if (!safe.startsWith(emitted)) throw Error("Unstable stream redaction");
    const next = safe.slice(emitted.length);
    emitted += next;
    return next;
  };
}
export function redactEvidence(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  const known = [...new Set(secrets.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const scrub = (text: string): string => {
    for (const secret of known) text = text.split(secret).join(marker);
    return text
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 " + marker)
      .replace(
        /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|client[-_]?secret)\s*[=:]\s*)[^\s&,;]+/gi,
        "$1" + marker,
      )
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1" + marker + "@");
  };
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 64) return "[OMITTED: depth limit]";
    if (typeof item === "string") {
      // Tool text blocks often contain JSON; redact fields inside that representation too.
      if (item.length <= 65536 && /^[\s]*[\[{]/.test(item)) {
        try {
          const parsed: unknown = JSON.parse(item);
          if (parsed && typeof parsed === "object") {
            const safe = JSON.stringify(visit(parsed, depth + 1));
            return safe === JSON.stringify(parsed) ? item : safe;
          }
        } catch {
          /* ordinary text */
        }
      }
      return scrub(item);
    }
    if (Array.isArray(item)) return item.map((v) => visit(v, depth + 1));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, v]) => [
          scrub(key),
          secretKey.test(key) ? marker : visit(v, depth + 1),
        ]),
      );
    return item;
  };
  return visit(value, 0);
}
