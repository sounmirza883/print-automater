import { exec } from "node:child_process";
import SysTray, { type Menu, type MenuItem } from "systray";
import type pino from "pino";
import { TRAY_ICON_BASE64 } from "./icon.js";

const STATUS_URL = "http://127.0.0.1:7171";

export interface TrayHandle {
  setStatus(status: string): void;
  close(): void;
}

function openStatusPage(): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${STATUS_URL}"`
      : process.platform === "darwin"
        ? `open "${STATUS_URL}"`
        : `xdg-open "${STATUS_URL}"`;
  exec(cmd, () => {
    // Best-effort -- a missing default browser handler is not this
    // app's problem to solve; the loopback UI is reachable directly.
  });
}

/** §9.5's tray icon. Wrapped so a headless box, a missing shell32
 * integration, or any other tray-init failure degrades to "the agent
 * keeps running with no tray icon," never a crash -- the agent's job
 * (claim, print, report) doesn't depend on this UI existing. Returns
 * `null` when the tray genuinely could not start; callers must treat
 * that as a valid, expected outcome, not an error to propagate. */
export function createTray(logger: pino.Logger): TrayHandle | null {
  const statusItem: MenuItem = {
    title: "Status: starting...",
    tooltip: "",
    checked: false,
    enabled: false,
  };
  const openItem: MenuItem = {
    title: "Open status page",
    tooltip: STATUS_URL,
    checked: false,
    enabled: true,
  };
  const exitItem: MenuItem = {
    title: "Exit",
    tooltip: "",
    checked: false,
    enabled: true,
  };
  const menu: Menu = {
    icon: TRAY_ICON_BASE64,
    title: "Print Automated Agent",
    tooltip: "Print Automated Agent",
    items: [statusItem, openItem, exitItem],
  };

  try {
    const systray = new SysTray({ menu, debug: false, copyDir: true });

    systray.onError((err) => {
      logger.warn({ err }, "tray process reported an error");
    });

    systray.onClick((action) => {
      if (action.item === openItem) {
        openStatusPage();
      } else if (action.item === exitItem) {
        systray.kill(false);
        process.exit(0);
      }
    });

    return {
      setStatus(status: string) {
        statusItem.title = `Status: ${status}`;
        try {
          systray.sendAction({ type: "update-item", item: statusItem, seq_id: 0 });
        } catch (err) {
          logger.debug({ err }, "failed to update tray status text");
        }
      },
      close() {
        try {
          systray.kill(false);
        } catch {
          // already dead -- nothing to clean up
        }
      },
    };
  } catch (err) {
    logger.warn({ err }, "tray icon unavailable, continuing without one");
    return null;
  }
}
