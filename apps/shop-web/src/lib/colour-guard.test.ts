import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Every line of every component that matches `pattern`, as "file:line: text". */
function offenders(pattern: RegExp, allowed: (line: string, file: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file).replace(/\\/g, "/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line) && !allowed(line, name)) {
          found.push(`${name}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe("colour rules that keep both themes readable", () => {
  it("uses white text only on the danger fill (white on an inverse or accent fill vanishes in dark)", () => {
    expect(offenders(/\btext-white\b/, (line) => /\bbg-danger\b/.test(line))).toEqual([]);
  });

  it("never fills a control with the accent colour (primary actions are bg-inv)", () => {
    // Status marks stay allowed: a tone-map entry (`accent: "bg-accent"`) or a small dot.
    expect(
      offenders(
        /\bbg-accent\b(?!-)/,
        (line) => /accent:\s*"bg-accent"/.test(line) || /\bsize-(1\.5|2)(?![\w.])/.test(line),
      ),
    ).toEqual([]);
  });

  it("uses the text-safe accent for accent-coloured text", () => {
    expect(offenders(/\btext-accent\b(?!-)/, () => false)).toEqual([]);
  });

  it("keeps literal white and black to the QR code and backdrops", () => {
    expect(
      offenders(
        /\bbg-(white|black)\b/,
        (line, file) =>
          file.endsWith("shop-qr-code.tsx") || /backdrop:bg-black|bg-black\/\d+/.test(line),
      ),
    ).toEqual([]);
  });

  it("has no hand-written field style (every input uses INPUT from form-kit)", () => {
    // Whole-file, not line by line: Prettier wraps a long string onto the line after the `=`.
    const found = sourceFiles(SRC)
      .filter((file) => /const (FIELD|SELECT)\b[^=;]*=\s*["`]/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).replace(/\\/g, "/"));
    expect(found).toEqual([]);
  });

  it("has no hand-written notice box (use Notice from the kit)", () => {
    // The recipe every hand-written one shares: a soft status fill with px-3 py-2.
    const recipe =
      /\b(danger|caution|good|accent)-soft\b[^"`]*\bpx-3 py-2\b|\bpx-3 py-2\b[^"`]*\b(danger|caution|good|accent)-soft\b/;
    expect(offenders(recipe, (_line, file) => file === "components/ui.tsx")).toEqual([]);
  });

  it("has no hand-written back arrow (use BackLink from the kit)", () => {
    expect(offenders(/&larr;|←/, (_line, file) => file === "components/ui.tsx")).toEqual([]);
  });

  it("sticks nothing to the very bottom of a screen, where the phone tab bar is", () => {
    // Use bottom-[var(--bottom-nav)]; only the tab bar itself may sit at bottom-0.
    expect(
      offenders(
        /\b(sticky|fixed)\b[^"`]*\bbottom-0\b|\bbottom-0\b[^"`]*\b(sticky|fixed)\b/,
        (_line, file) => file === "components/shell/bottom-tabs.tsx",
      ),
    ).toEqual([]);
  });

  it("has no hand-written copy of the field recipe (use INPUT from form-kit)", () => {
    // `px-2(?![\w.])` so the chart tooltip's `px-2.5` (not a field) is not caught.
    expect(
      offenders(
        /\brounded-md border border-line bg-panel px-2(?![\w.])/,
        (_line, file) => file === "components/form-kit.tsx",
      ),
    ).toEqual([]);
  });

  it("never glues a class name to a template hole (Tailwind would not generate the class)", () => {
    // `px-4 py-3.5${cond ? " x" : ""}` hides `py-3.5` from Tailwind's scanner: put a space before the hole.
    expect(offenders(/className=\{`[^`]*[\w.\])]\$\{/, () => false)).toEqual([]);
  });
});
