import { buildXlsx, crc32, sheetName } from "./xlsx.js";

/** Reads the stored-zip back far enough to prove the container is well formed. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.length - 22;
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    expect(buffer.readUInt32LE(localOffset)).toBe(0x04034b50);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26);
    const data = buffer.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    cursor += 46 + nameLength;
  }
  return files;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildXlsx", () => {
  const files = readZip(
    buildXlsx([
      {
        name: "Summary",
        rows: [
          ["Period", "Received"],
          ["2026-10", 6000],
        ],
      },
      {
        name: "Payments",
        rows: [["Business"], ['=HYPERLINK("http://evil")'], ["A & B <c>"], [null]],
      },
    ]),
  );

  it("contains the parts a spreadsheet needs", () => {
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const workbook = files.get("xl/workbook.xml")!.toString("utf8");
    expect(workbook).toContain('name="Summary"');
    expect(workbook).toContain('name="Payments"');
  });

  it("writes numbers as numbers and text as inert inline strings", () => {
    const first = files.get("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(first).toContain('<c r="B2"><v>6000</v></c>');
    expect(first).toContain('<c r="A1" s="1" t="inlineStr">');

    const second = files.get("xl/worksheets/sheet2.xml")!.toString("utf8");
    // A formula-looking cell is stored as text, never as <f>.
    expect(second).not.toContain("<f>");
    expect(second).toContain("=HYPERLINK(&quot;http://evil&quot;)");
    expect(second).toContain("A &amp; B &lt;c&gt;");
  });

  it("strips characters XML cannot carry", () => {
    const out = readZip(buildXlsx([{ name: "X", rows: [["a\u0000b\u0008c"]] }]));
    expect(out.get("xl/worksheets/sheet1.xml")!.toString("utf8")).toContain(">abc<");
  });
});

describe("sheetName", () => {
  it("removes forbidden characters, caps at 31 and falls back when empty", () => {
    expect(sheetName("Q1/Q2: [draft]?", "S")).toBe("Q1 Q2   draft");
    expect(sheetName("x".repeat(40), "S")).toHaveLength(31);
    expect(sheetName("   ", "Sheet1")).toBe("Sheet1");
  });
});
