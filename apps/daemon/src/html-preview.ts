import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { RockyError } from "../../../packages/contracts/src/index.js";

// Data-only HTML. No parser or preview resource is allowed to access the host.
const tags = new Set(
  "div span p br hr h1 h2 h3 h4 h5 h6 header footer main section article aside nav ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td pre code blockquote strong em b i u s small sub sup mark abbr time details summary a img style".split(
    " ",
  ),
);
const attributes = new Set([
  "id",
  "class",
  "title",
  "lang",
  "dir",
  "style",
  "alt",
]);
export const previewCsp =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'";
export function htmlPreview(source: string) {
  if (Buffer.byteLength(source, "utf8") > 1048576)
    throw new RockyError("preview_limit", "HTML preview is too large", 422);
  const root = parseFragment(source);
  const stack: { parent: DefaultTreeAdapterTypes.ParentNode; depth: number }[] =
    [{ parent: root, depth: 0 }];
  let omitted = 0,
    count = 0;
  while (stack.length) {
    const { parent, depth } = stack.pop()!;
    parent.childNodes = parent.childNodes.filter((node) => {
      if (++count > 10000 || depth > 128) {
        omitted++;
        return false;
      }
      if (node.nodeName === "#text") return true;
      if (
        !("tagName" in node) ||
        node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        !tags.has(node.tagName)
      ) {
        omitted++;
        return false;
      }
      node.attrs = node.attrs.filter((attr) => {
        if (attr.namespace || attr.prefix) {
          omitted++;
          return false;
        }
        if (attributes.has(attr.name)) return true;
        if (
          ["colspan", "rowspan"].includes(attr.name) &&
          /^\d{1,3}$/.test(attr.value)
        )
          return true;
        if (attr.name === "open" && node.tagName === "details") return true;
        if (
          attr.name === "src" &&
          node.tagName === "img" &&
          /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(attr.value)
        )
          return true;
        omitted++;
        return false;
      });
      stack.push({ parent: node, depth: depth + 1 });
      return true;
    });
  }
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp}"><meta name="referrer" content="no-referrer"><style>html{font:14px/1.6 system-ui,sans-serif;color:#222;background:#fff}body{margin:16px;overflow-wrap:anywhere}img,table{max-width:100%}pre{overflow:auto}</style></head><body>${serialize(root)}</body></html>`,
    omitted,
  };
}
