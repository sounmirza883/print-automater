import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import type { HeartbeatInput } from "@print-automated/validation";

const execFileAsync = promisify(execFile);

export interface DiscoveredPrinter {
  name: string;
  driverName: string;
  portName: string;
  status: "ONLINE" | "ERROR";
  capabilities: { color: boolean; duplex: boolean; a4: boolean; a3: boolean };
}

interface RawDiscoveredPrinter {
  Name: string;
  DriverName: string;
  PortName: string;
  Status: string;
  Color: boolean;
  Duplex: boolean;
}

/** §9.6. `Get-Printer` enumerates every installed print queue (driver
 * present, not necessarily a physically reachable device);
 * `Get-PrintConfiguration` reports that queue's *current default*
 * settings, the only capability signal cheaply available without
 * parsing a driver-specific `Get-PrintCapabilities` device-capability
 * document. `-ErrorAction SilentlyContinue` on the per-printer config
 * lookup matters: a driver that fails to answer must not blank out
 * every other printer's row in the same discovery pass. Runs as a
 * single `-Command` script (not a temp `.ps1` + `-File`) -- one
 * process spawn per discovery cycle instead of a file write, read,
 * and cleanup on every one. */
const DISCOVERY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$results = @()
foreach ($p in Get-Printer) {
  $config = Get-PrintConfiguration -PrinterName $p.Name -ErrorAction SilentlyContinue
  $color = $false
  $duplex = $false
  if ($config) {
    $color = [bool]$config.Color
    $duplex = $config.DuplexingMode -ne 'OneSided'
  }
  $results += [PSCustomObject]@{
    Name = $p.Name
    DriverName = $p.DriverName
    PortName = $p.PortName
    Status = $p.PrinterStatus.ToString()
    Color = $color
    Duplex = $duplex
  }
}
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
`;

function toDiscoveredPrinter(raw: RawDiscoveredPrinter): DiscoveredPrinter {
  return {
    name: raw.Name,
    driverName: raw.DriverName,
    portName: raw.PortName,
    // §41/9.4's heartbeat schema is deliberately binary (ONLINE or
    // ERROR only -- OFFLINE is a backend-inferred, missed-heartbeat
    // state, never something the agent claims about a queue it can
    // still see). `Get-Printer`'s PrinterStatus enum has dozens of
    // values (PaperJam, NoToner, DoorOpen, Offline, ...); "Normal" is
    // the only one that means "no problem," so it's the only one that
    // maps to ONLINE.
    status: raw.Status === "Normal" ? "ONLINE" : "ERROR",
    capabilities: {
      color: raw.Color,
      duplex: raw.Duplex,
      // §9.6's own named risk: driver-reported capabilities are
      // unreliable, and neither `Get-Printer` nor
      // `Get-PrintConfiguration` exposes the *supported* paper-size
      // set, only the current default. A4 is near-universal, so it
      // defaults true; A3 is uncommon and the wrong direction to
      // default true (a job accepted as A3-capable that the printer
      // can't actually feed is a failed print, not just a cosmetic
      // error), so it defaults false. Staff's manual override toggle
      // (the Shop app's Printers screen) is the explicit, intended
      // escape hatch when a driver's real capabilities differ.
      a4: true,
      a3: false,
    },
  };
}

export async function discoverPrinters(logger: pino.Logger): Promise<DiscoveredPrinter[]> {
  if (process.platform !== "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", DISCOVERY_SCRIPT],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const parsed: RawDiscoveredPrinter | RawDiscoveredPrinter[] = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(toDiscoveredPrinter);
  } catch (err) {
    logger.warn({ err }, "printer discovery failed -- reporting no printers this beat");
    return [];
  }
}

export type HeartbeatPrinter = HeartbeatInput["printers"][number];

/** Only includes `capabilities` for a printer when this process's own
 * last-reported snapshot for that name differs from what it just
 * discovered -- the backend's own merge rule (`reported.capabilities
 * ?? existing.capabilities`, agent-heartbeat.service.ts) keeps
 * whatever it already has when a beat omits the field. Reporting
 * unchanged capabilities on every single beat would silently re-clobber
 * a staff-made manual override (updatePrinterSchema) within seconds of
 * it being set; omitting them once nothing has changed lets an
 * override actually stick for the rest of this process's run. */
export function toHeartbeatPrinters(
  discovered: DiscoveredPrinter[],
  lastReported: Map<string, DiscoveredPrinter["capabilities"]>,
): HeartbeatPrinter[] {
  return discovered.map((printer) => {
    const previous = lastReported.get(printer.name);
    const changed =
      previous === undefined ||
      previous.color !== printer.capabilities.color ||
      previous.duplex !== printer.capabilities.duplex ||
      previous.a4 !== printer.capabilities.a4 ||
      previous.a3 !== printer.capabilities.a3;

    if (changed) {
      lastReported.set(printer.name, printer.capabilities);
    }

    return {
      name: printer.name,
      status: printer.status,
      ...(changed ? { capabilities: printer.capabilities } : {}),
    };
  });
}
