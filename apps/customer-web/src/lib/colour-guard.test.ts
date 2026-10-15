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
  it("uses no Tailwind default greys (they ignore the dark theme)", () => {
    expect(
      offenders(
        /\b(text|bg|border|ring|divide|from|to|via)-(gray|slate|zinc|neutral|stone)-\d/,
        () => false,
      ),
    ).toEqual([]);
  });

  it("sets no colour through inline styles", () => {
    expect(offenders(/style=\{\{[^}]*(color|background|border)/i, () => false)).toEqual([]);
  });

  it("uses white text only on the danger fill", () => {
    expect(offenders(/\btext-white\b/, (line) => /\bbg-danger\b/.test(line))).toEqual([]);
  });

  it("uses no literal black fill and no hex colour in a class", () => {
    expect(offenders(/\bbg-black\b(?!\/)|\[#[0-9a-fA-F]{3,6}\]/, () => false)).toEqual([]);
  });

  it("never glues a class name to a template hole (Tailwind would not generate the class)", () => {
    expect(offenders(/className=\{`[^`]*[\w.\])]\$\{/, () => false)).toEqual([]);
  });
});
