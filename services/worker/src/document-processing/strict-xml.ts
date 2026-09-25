/** 21.11: a small, STRICT, streaming XML tokenizer for the DOCX security
 * gate. It is deliberately not a general XML parser: it accepts the subset
 * Office Open XML parts use and throws on anything else, so the gate fails
 * CLOSED. A malformed, ambiguous or exotic part is an error, never "skipped".
 *
 * - encoding: UTF-8 (BOM optional), or UTF-16 WITH a BOM. UTF-16 without a
 *   BOM, invalid UTF-8, NUL bytes and any other declared encoding are errors;
 * - no DOCTYPE, no entity declarations, no processing instructions other than
 *   the leading XML declaration (XXE / billion laughs impossible: only the
 *   five predefined and numeric character references are expanded);
 * - '>' inside a quoted attribute value is handled by real quote scanning;
 * - namespace prefixes are kept in qnames; callers use localName().
 */

export class XmlParseError extends Error {
  constructor(
    readonly kind: "MALFORMED" | "DOCTYPE",
    message: string,
  ) {
    super(message);
    this.name = "XmlParseError";
  }
}

export interface XmlVisitor {
  onOpen?(qname: string, attrs: Map<string, string>): void;
  onText?(text: string): void;
  onClose?(qname: string): void;
}

const MAX_DEPTH = 256;
const MAX_ELEMENTS = 3_000_000;

export function localName(qname: string): string {
  const colon = qname.lastIndexOf(":");
  return colon < 0 ? qname : qname.slice(colon + 1);
}

function malformed(message: string): never {
  throw new XmlParseError("MALFORMED", message);
}

/** Decodes the raw bytes of an XML part, enforcing the encoding rules. */
export function decodeXmlBytes(bytes: Buffer): { text: string; utf16: boolean } {
  let text: string;
  let utf16 = false;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    utf16 = true;
    text = decodeUtf16(bytes.subarray(2), false);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    utf16 = true;
    text = decodeUtf16(bytes.subarray(2), true);
  } else {
    if (bytes.includes(0)) malformed("NUL byte (UTF-16 without a BOM?)");
    const body =
      bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? bytes.subarray(3)
        : bytes;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return malformed("invalid UTF-8");
    }
  }
  return { text, utf16 };
}

function decodeUtf16(body: Buffer, bigEndian: boolean): string {
  if (body.length % 2 !== 0) malformed("odd UTF-16 length");
  const copy = Buffer.from(body);
  if (bigEndian) copy.swap16();
  return copy.toString("utf16le");
}

const NAME_START = /[A-Za-z_À-￿]/;
const NAME_RE = /[A-Za-z_À-￿][A-Za-z0-9_.:·À-￿-]*/y;
const ENTITY_RE = /&(?:#x([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/y;

function decodeEntities(raw: string, isAttribute: boolean): string {
  if (isAttribute && raw.includes("<")) malformed("'<' in attribute value");
  if (!raw.includes("&")) return raw;
  let out = "";
  let last = 0;
  for (let i = raw.indexOf("&"); i >= 0; i = raw.indexOf("&", last)) {
    out += raw.slice(last, i);
    ENTITY_RE.lastIndex = i;
    const match = ENTITY_RE.exec(raw);
    if (!match) return malformed("undeclared or malformed entity reference");
    if (match[3]) {
      out += { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[match[3]]!;
    } else {
      const code = match[1] ? parseInt(match[1], 16) : parseInt(match[2]!, 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        malformed("invalid character reference");
      }
      out += String.fromCodePoint(code);
    }
    last = ENTITY_RE.lastIndex;
  }
  return out + raw.slice(last);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Streams `bytes` through `visitor`, or throws XmlParseError. */
export function walkXml(bytes: Buffer, visitor: XmlVisitor): void {
  const { text: xml, utf16 } = decodeXmlBytes(bytes);
  const stack: string[] = [];
  let i = 0;
  let rootSeen = false;
  let elements = 0;

  if (xml.startsWith("<?xml") && /[\s?]/.test(xml[5] ?? "")) {
    const end = xml.indexOf("?>");
    if (end < 0) malformed("unterminated XML declaration");
    const encoding = /encoding\s*=\s*["']([^"']*)["']/.exec(xml.slice(0, end))?.[1];
    if (encoding !== undefined) {
      const enc = encoding.toLowerCase();
      const ok = utf16
        ? enc === "utf-16" || enc === "utf-16le" || enc === "utf-16be"
        : enc === "utf-8";
      if (!ok) malformed(`unsupported declared encoding ${encoding}`);
    }
    i = end + 2;
  }

  const length = xml.length;
  while (i < length) {
    if (xml[i] !== "<") {
      const next = xml.indexOf("<", i);
      const end = next < 0 ? length : next;
      const raw = xml.slice(i, end);
      if (stack.length === 0) {
        if (raw.trim() !== "") malformed("text outside the root element");
      } else {
        if (raw.includes("]]>")) malformed("']]>' in text");
        visitor.onText?.(decodeEntities(raw, false));
      }
      i = end;
      continue;
    }

    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) malformed("unterminated comment");
      if (xml.slice(i + 4, end).includes("--")) malformed("'--' inside a comment");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      if (stack.length === 0) malformed("CDATA outside the root element");
      const end = xml.indexOf("]]>", i + 9);
      if (end < 0) malformed("unterminated CDATA");
      visitor.onText?.(xml.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<!", i)) {
      throw new XmlParseError("DOCTYPE", "DOCTYPE/entity declarations are not allowed");
    }
    if (xml.startsWith("<?", i)) malformed("processing instructions are not allowed");

    if (xml[i + 1] === "/") {
      NAME_RE.lastIndex = i + 2;
      const nameMatch = NAME_RE.exec(xml);
      if (!nameMatch) malformed("bad end tag");
      let j = NAME_RE.lastIndex;
      while (isWhitespace(xml[j])) j += 1;
      if (xml[j] !== ">") malformed("bad end tag");
      const qname = nameMatch[0];
      if (stack.pop() !== qname) malformed("mismatched end tag");
      visitor.onClose?.(qname);
      i = j + 1;
      continue;
    }

    // Start tag.
    if (!NAME_START.test(xml[i + 1] ?? "")) malformed("bad start tag");
    NAME_RE.lastIndex = i + 1;
    const nameMatch = NAME_RE.exec(xml)!;
    const qname = nameMatch[0];
    let j = NAME_RE.lastIndex;
    const attrs = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      const hadSpace = isWhitespace(xml[j]);
      while (isWhitespace(xml[j])) j += 1;
      const ch = xml[j];
      if (ch === undefined) malformed("unterminated start tag");
      if (ch === ">") {
        j += 1;
        break;
      }
      if (ch === "/") {
        if (xml[j + 1] !== ">") malformed("bad self-closing tag");
        selfClosing = true;
        j += 2;
        break;
      }
      if (!hadSpace) malformed("attributes must be separated by whitespace");
      NAME_RE.lastIndex = j;
      const attrMatch = NAME_RE.exec(xml);
      if (!attrMatch) malformed("bad attribute name");
      j = NAME_RE.lastIndex;
      while (isWhitespace(xml[j])) j += 1;
      if (xml[j] !== "=") malformed("attribute without a value");
      j += 1;
      while (isWhitespace(xml[j])) j += 1;
      const quote = xml[j];
      if (quote !== '"' && quote !== "'") malformed("unquoted attribute value");
      const close = xml.indexOf(quote, j + 1);
      if (close < 0) malformed("unterminated attribute value");
      if (attrs.has(attrMatch[0])) malformed("duplicate attribute");
      attrs.set(attrMatch[0], decodeEntities(xml.slice(j + 1, close), true));
      j = close + 1;
    }

    if (stack.length === 0) {
      if (rootSeen) malformed("more than one root element");
      rootSeen = true;
    }
    elements += 1;
    if (elements > MAX_ELEMENTS) malformed("too many elements");
    visitor.onOpen?.(qname, attrs);
    if (selfClosing) {
      visitor.onClose?.(qname);
    } else {
      stack.push(qname);
      if (stack.length > MAX_DEPTH) malformed("nesting too deep");
    }
    i = j;
  }

  if (stack.length > 0) malformed("unclosed element");
  if (!rootSeen) malformed("no root element");
}
