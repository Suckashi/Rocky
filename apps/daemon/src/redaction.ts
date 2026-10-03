const secretKey =
  /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|client[-_]?secret)$/i;
const marker = "[REDACTED]";
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
