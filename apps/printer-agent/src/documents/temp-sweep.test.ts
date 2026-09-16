import { mkdtemp, readdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import type pino from "pino";
import { sweepTempFiles } from "./temp-sweep.js";

function silentLogger(): pino.Logger {
  return { warn: jest.fn() } as unknown as pino.Logger;
}

/** §68/9.8/11.6, the temp-file half of 11.6's own Done-when: "orphans
 * from a force-killed run are gone after the next start." Runs against
 * a real scratch directory, not the real TMP_DIR -- sweepTempFiles's
 * own `tmpDir` parameter exists specifically for this. */
describe("sweepTempFiles (11.6)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "temp-sweep-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("startup mode (minAgeMs=0) removes every file regardless of age", async () => {
    await writeFile(join(dir, "job-1.pdf"), "fake pdf");
    await writeFile(join(dir, "job-2.pdf"), "fake pdf");

    const removed = await sweepTempFiles(silentLogger(), 0, dir);

    expect(removed).toBe(2);
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("periodic mode (a real minAgeMs) leaves a fresh file alone", async () => {
    const filePath = join(dir, "job-1.pdf");
    await writeFile(filePath, "fake pdf");

    const removed = await sweepTempFiles(silentLogger(), 60 * 60_000, dir);

    expect(removed).toBe(0);
    expect(await readdir(dir)).toEqual(["job-1.pdf"]);
  });

  it("periodic mode removes a file older than the age threshold", async () => {
    const filePath = join(dir, "job-1.pdf");
    await writeFile(filePath, "fake pdf");
    const oldTime = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(filePath, oldTime, oldTime);

    const removed = await sweepTempFiles(silentLogger(), 60 * 60_000, dir);

    expect(removed).toBe(1);
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("an empty or missing directory is a safe no-op", async () => {
    const removed = await sweepTempFiles(silentLogger(), 0, join(dir, "does-not-exist"));
    expect(removed).toBe(0);
  });
});
