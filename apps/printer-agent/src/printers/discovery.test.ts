import { toHeartbeatPrinters, type LastReportedPrinterState } from "./discovery.js";
import type { DiscoveredPrinter } from "./discovery.js";

function printer(overrides: Partial<DiscoveredPrinter> = {}): DiscoveredPrinter {
  return {
    name: "Front Desk HP LaserJet",
    driverName: "HP LaserJet Pro M404-M405 PCL-6",
    portName: "USB001",
    status: "ONLINE",
    capabilities: { color: false, duplex: true, a4: true, a3: false },
    ...overrides,
  };
}

describe("toHeartbeatPrinters (15.6)", () => {
  it("reports name/status/capabilities/driverName/portName on the first beat for a printer", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    const [result] = toHeartbeatPrinters([printer()], lastReported);
    expect(result).toEqual({
      name: "Front Desk HP LaserJet",
      status: "ONLINE",
      capabilities: { color: false, duplex: true, a4: true, a3: false },
      driverName: "HP LaserJet Pro M404-M405 PCL-6",
      portName: "USB001",
    });
  });

  it("omits capabilities, driverName, and portName once unchanged since the last beat", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    toHeartbeatPrinters([printer()], lastReported);

    const [second] = toHeartbeatPrinters([printer()], lastReported);
    expect(second).toEqual({ name: "Front Desk HP LaserJet", status: "ONLINE" });
  });

  it("resends only driverName when the driver changes but capabilities/port don't", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    toHeartbeatPrinters([printer()], lastReported);

    const [second] = toHeartbeatPrinters(
      [printer({ driverName: "HP LaserJet Pro M404-M405 PCL-6 (Copy 2)" })],
      lastReported,
    );
    expect(second).toEqual({
      name: "Front Desk HP LaserJet",
      status: "ONLINE",
      driverName: "HP LaserJet Pro M404-M405 PCL-6 (Copy 2)",
    });
  });

  it("resends only portName when the port changes but capabilities/driver don't", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    toHeartbeatPrinters([printer()], lastReported);

    const [second] = toHeartbeatPrinters([printer({ portName: "USB002" })], lastReported);
    expect(second).toEqual({
      name: "Front Desk HP LaserJet",
      status: "ONLINE",
      portName: "USB002",
    });
  });

  it("resends capabilities alone when only capabilities change", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    toHeartbeatPrinters([printer()], lastReported);

    const [second] = toHeartbeatPrinters(
      [printer({ capabilities: { color: true, duplex: true, a4: true, a3: false } })],
      lastReported,
    );
    expect(second).toEqual({
      name: "Front Desk HP LaserJet",
      status: "ONLINE",
      capabilities: { color: true, duplex: true, a4: true, a3: false },
    });
  });

  it("tracks each printer name independently", () => {
    const lastReported = new Map<string, LastReportedPrinterState>();
    toHeartbeatPrinters([printer({ name: "A" }), printer({ name: "B" })], lastReported);

    const [a, b] = toHeartbeatPrinters(
      [printer({ name: "A" }), printer({ name: "B", portName: "USB999" })],
      lastReported,
    );
    expect(a).toEqual({ name: "A", status: "ONLINE" });
    expect(b).toEqual({ name: "B", status: "ONLINE", portName: "USB999" });
  });
});
