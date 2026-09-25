import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { XmlParseError, localName, walkXml, type XmlVisitor } from "./strict-xml.js";

/** 21.11: the external-content gate. LibreOffice would read local files
 * (file:///..., UNC paths) or fetch remote content (SSRF, NTLM leak) into the
 * PDF the customer downloads if a DOCX points it there. Everything here fails
 * CLOSED: a part that cannot be parsed strictly is rejected, not skipped. */

const HYPERLINK_TYPE_SUFFIX = "/hyperlink";
const SAFE_HYPERLINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/** Field codes that pull in external content or run DDE. */
const BLOCKED_FIELDS = new Set([
  "INCLUDEPICTURE",
  "INCLUDETEXT",
  "LINK",
  "DDE",
  "DDEAUTO",
  "IMPORT",
  "DATABASE",
]);
const BLOCKED_FIELD_ANYWHERE = /\b(INCLUDEPICTURE|INCLUDETEXT|DDEAUTO|DDE|IMPORT|LINK|DATABASE)\b/i;

/** Word-part elements that embed or import foreign content. */
const BLOCKED_ELEMENTS = new Set(["altchunk", "oleobject"]);

function external(): never {
  throw new DocumentRejectedError(RejectionReason.EXTERNAL_CONTENT);
}

/** Runs a strict-XML walk, mapping parser failures to fail-closed rejections. */
export function guardXml(bytes: Buffer, visitor: XmlVisitor): void {
  try {
    walkXml(bytes, visitor);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new DocumentRejectedError(
        error.kind === "DOCTYPE" ? RejectionReason.EXTERNAL_CONTENT : RejectionReason.CORRUPT_FILE,
      );
    }
    throw error;
  }
}

/** Case-insensitive attribute lookup by LOCAL name (ignores any prefix). */
function attr(attrs: Map<string, string>, local: string): string | undefined {
  for (const [name, value] of attrs) {
    if (localName(name).toLowerCase() === local) return value;
  }
  return undefined;
}

/** Lower-cased URI scheme after stripping the whitespace/control characters
 * URL parsers ignore; "" when there is none. UNC (\\host, //host) is "unc". */
function schemeOf(target: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = target.replace(/[\u0000- ]/g, "");
  if (cleaned.startsWith("\\\\") || cleaned.startsWith("//")) return "unc";
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned);
  return match ? match[1]!.toLowerCase() : "";
}

export function scanRelationshipsPart(bytes: Buffer): void {
  guardXml(bytes, {
    onOpen(qname, attrs) {
      if (localName(qname).toLowerCase() !== "relationship") return;
      const type = (attr(attrs, "type") ?? "").toLowerCase();
      const target = attr(attrs, "target") ?? "";
      const isExternal = (attr(attrs, "targetmode") ?? "").toLowerCase() === "external";
      const scheme = schemeOf(target);
      if (type.endsWith(HYPERLINK_TYPE_SUFFIX)) {
        // A hyperlink is text the converter never fetches, but a file: or
        // UNC target has no business in a printable document either.
        if (scheme !== "" && !SAFE_HYPERLINK_SCHEMES.has(scheme)) external();
        return;
      }
      // Any other relationship must stay inside the package: no external
      // mode, and no absolute URI or UNC target even when the mode is omitted.
      if (isExternal || scheme !== "") external();
    },
  });
}

function checkInstruction(instruction: string): void {
  const first = /^\s*([A-Za-z]+)/.exec(instruction)?.[1]?.toUpperCase();
  // Quoted strings (URLs, bookmark text) are not field names.
  const unquoted = instruction.replace(/"[^"]*"/g, '""');
  if ((first && BLOCKED_FIELDS.has(first)) || BLOCKED_FIELD_ANYWHERE.test(unquoted)) {
    external();
  }
}

/** Scans one word/*.xml part for dangerous field codes and for elements or
 * attributes that reference external or embedded foreign content. */
export function scanWordPart(bytes: Buffer): void {
  // Complex fields: begin ... instrText pieces ... separate ... end, nestable.
  const stack: string[] = [];
  let loose = "";
  let inInstruction = false;

  guardXml(bytes, {
    onOpen(qname, attrs) {
      const name = localName(qname).toLowerCase();
      if (BLOCKED_ELEMENTS.has(name)) external();

      for (const [attributeName, value] of attrs) {
        if (attributeName === "xmlns" || attributeName.startsWith("xmlns:")) continue;
        const attributeLocal = localName(attributeName).toLowerCase();
        const prefix = attributeName.includes(":") ? attributeName.split(":")[0] : "";
        // r:link (linked image), o:href / v:imagedata src and friends.
        if (attributeLocal === "link" && prefix !== "w") external();
        if ((attributeLocal === "href" || attributeLocal === "src") && schemeOf(value) !== "") {
          external();
        }
      }

      if (name === "fldsimple") {
        checkInstruction(attr(attrs, "instr") ?? "");
      } else if (name === "fldchar") {
        const kind = attr(attrs, "fldchartype");
        if (kind === "begin") stack.push("");
        else if (kind === "end") {
          const done = stack.pop();
          if (done !== undefined) checkInstruction(done);
        }
      } else if (name === "instrtext" || name === "delinstrtext") {
        inInstruction = true;
      }
    },
    onText(text) {
      if (!inInstruction) return;
      if (stack.length > 0) stack[stack.length - 1] += text;
      else loose += text;
    },
    onClose(qname) {
      const name = localName(qname).toLowerCase();
      if (name === "instrtext" || name === "delinstrtext") inInstruction = false;
    },
  });

  // Unbalanced fields: inspect whatever instruction text is left over.
  for (const leftover of stack) checkInstruction(leftover);
  if (loose !== "") checkInstruction(loose);
}
