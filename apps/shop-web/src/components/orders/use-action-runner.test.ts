import { createActionRunner } from "./use-action-runner";

function setup() {
  const log: string[] = [];
  const run = createActionRunner({
    onChanged: () => log.push("changed"),
    setBusy: (busy) => log.push(busy ? "busy" : "idle"),
    setError: (error) => log.push(`error:${error ?? "none"}`),
  });
  return { run, log };
}

const apiError = (status: number, error_code: string) => ({
  status,
  error_code,
  message: "server",
});

describe("createActionRunner", () => {
  it("never double-submits: a second call while one is pending is refused without running", async () => {
    const { run } = setup();
    let release: () => void = () => undefined;
    const action = jest.fn(() => new Promise<void>((resolve) => (release = resolve)));

    const first = run(action);
    const second = await run(action);
    expect(second).toBe("busy");
    expect(action).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe("ok");
    // After it settles a new action may run again.
    expect(await run(async () => undefined)).toBe("ok");
  });

  it("marks busy for the whole request and reloads after success", async () => {
    const { run, log } = setup();
    await run(async () => undefined);
    expect(log).toEqual(["busy", "error:none", "changed", "idle"]);
  });

  it("shows the exact wording for a known error code and does not reload for it", async () => {
    const { run, log } = setup();
    const outcome = await run(async () => {
      throw apiError(409, "PRINTER_CAPABILITY_MISMATCH");
    });
    expect(outcome).toBe("failed");
    expect(log.find((entry) => entry.startsWith("error:") && entry !== "error:none")).toMatch(
      /cannot do this job/,
    );
    expect(log).not.toContain("changed");
  });

  it("reloads the screen when the failure means its data is stale", async () => {
    const { run, log } = setup();
    await run(async () => {
      throw apiError(409, "ILLEGAL_JOB_TRANSITION");
    });
    expect(log).toContain("changed");
  });

  it("reports LATE_PRINT_ACK_REQUIRED as its own outcome, with no error text", async () => {
    const { run, log } = setup();
    const outcome = await run(async () => {
      throw apiError(409, "LATE_PRINT_ACK_REQUIRED");
    });
    expect(outcome).toBe("late-print");
    expect(log.filter((entry) => entry.startsWith("error:") && entry !== "error:none")).toEqual([]);
  });

  it("releases the lock after a failure so the person can correct and resubmit", async () => {
    const { run } = setup();
    await run(async () => {
      throw apiError(400, "VALIDATION_FAILED");
    });
    expect(await run(async () => undefined)).toBe("ok");
  });
});
