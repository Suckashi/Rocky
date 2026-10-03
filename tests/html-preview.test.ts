import { test, expect } from "vitest";
import { htmlPreview, previewCsp } from "../apps/daemon/src/html-preview.js";
import { parseFragment } from "parse5";
test("HTML preview strips active/navigation content, keeps safe layout and installs restrictive CSP first", () => {
  const source = `<meta http-equiv=refresh content="0;url=https://attack.invalid"><base href="https://attack.invalid/"><script>parent.document.body.innerHTML='owned'</script><iframe src=/api/v1/session></iframe><form action=/api/v1/documents><input name=x></form><svg><a xlink:href=javascript:alert(1)>svg</a></svg><math><mtext><img src=x onerror=alert(1)></mtext></math><template><script>alert(1)</script></template><style>.report{color:navy}</style><section class=report onclick=alert(1)><h1>SAFE_REPORT</h1><table><tr><td colspan=2>DATA</td></tr></table><a href=/api/v1/session ping=https://attack.invalid target=_top>LINK_TEXT</a><img src="data:image/png;base64,AAAA" alt=local><img srcset=https://attack.invalid src=/api/v1/session></section>`;
  const { html, omitted } = htmlPreview(source);
  expect(omitted).toBeGreaterThan(10);
  expect(html).toContain(previewCsp);
  expect(html).toContain("SAFE_REPORT");
  expect(html).toContain('colspan="2"');
  expect(html).toContain(".report{color:navy}");
  expect(html).toContain("LINK_TEXT");
  expect(html).not.toMatch(/<(?:script|iframe|form|svg|math|template|base)\b/i);
  expect(html).not.toMatch(/(?:onclick|onerror|srcset|href|ping|target)=/i);
  expect(html).not.toContain("attack.invalid");
  expect(html).toContain('src="data:image/png;base64,AAAA"');
  expect(parseFragment(html)).toBeDefined();
  expect(source).toContain("<script>");
});
test("HTML sanitizer bounds nested trees and input size", () => {
  const result = htmlPreview(
    "<div>".repeat(5000) + "DEEP" + "</div>".repeat(5000),
  );
  expect(result.omitted).toBeGreaterThan(0);
  expect(result.html.length).toBeLessThan(10000);
  expect(() => htmlPreview("x".repeat(1048577))).toThrow("too large");
});
