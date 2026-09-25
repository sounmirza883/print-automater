import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "Printer agent",
  description:
    "Install the Print Automated printer agent on Windows, pair it with a one-time code, and understand how it authenticates, polls for jobs and reports status.",
  alternates: { canonical: "/docs/printer-agent" },
};

const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "requirements", label: "Requirements" },
  { id: "pairing", label: "Pairing" },
  { id: "running", label: "Running on Windows" },
  { id: "how-it-works", label: "How it works" },
  { id: "files", label: "Files and data" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const statusExample = `curl http://127.0.0.1:7171/api/status

{
  "paired": true,
  "deviceId": "3f0c9d52-0000-4000-8000-000000000000",
  "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
  "pairing": false,
  "lastError": null,
  "lastHeartbeatAt": "2026-01-01T10:15:30.000Z"
}`;

const flowExample = `# 1. Pair once (agent -> API). The private key never leaves the PC.
POST /v1/agents/register
{ "pairingCode": "K7M2XQ9P", "deviceId": "<uuid>", "publicKey": "<base64url Ed25519>" }
-> { "deviceId": "<uuid>", "shopId": "<uuid>" }

# 2. Every session: prove possession of the key.
POST /v1/agents/authenticate/challenge   { "deviceId": "<uuid>" }  -> { "nonce": "..." }
POST /v1/agents/authenticate             { "deviceId": "<uuid>", "signature": "<sig of nonce>" }
-> { "accessToken": "eyJhbGciOi...FAKE_AGENT_TOKEN" }   # valid 15 minutes

# 3. Work loop, with Authorization: Bearer <accessToken>
POST /v1/agents/heartbeat                # every 30 s
GET  /v1/agents/jobs?wait=25             # long-poll: 200 job | 204 nothing yet
POST /v1/agents/jobs/:id/claim
GET  /v1/agents/jobs/:id/document        # PDF bytes
POST /v1/agents/jobs/:id/status          # { "status": "PRINTING" | "PRINTED" | "FAILED" | "UNKNOWN" }`;

export default function PrinterAgentPage() {
  return (
    <DocPage
      href="/docs/printer-agent"
      title="Printer agent"
      lede="A small Windows program that sits next to your printers, fetches jobs from Print Automated and prints them. It only ever makes outbound connections."
      toc={toc}
    >
      <h2 id="overview">Overview</h2>
      <p>
        The agent is what turns an accepted order into paper. It registers the printers Windows can
        see, reports whether each one is healthy, waits for jobs assigned to it, downloads the
        document, sends it to the right printer and reports the outcome. Because the agent always
        calls out to the API, you do not need to open ports in your router or expose the PC to the
        internet.
      </p>

      <h2 id="requirements">Requirements</h2>
      <ul>
        <li>Windows with the printers you want to use already installed and working.</li>
        <li>
          A permission-holding staff member to issue the pairing code (<code>MANAGE_PRINTERS</code>:
          Owner, Manager, Counter or Printer manager may request one).
        </li>
        <li>Outbound HTTPS access to your Print Automated API.</li>
      </ul>

      <h2 id="pairing">Pairing</h2>
      <p>Pairing links one PC to one business. It happens once.</p>
      <ol>
        <li>
          A staff member requests a pairing code for the business (
          <code>POST /v1/shop/agents/pairing-code</code>). The code is 8 characters, avoids
          look-alike characters such as 0/O and 1/I/L, is single use and expires after 10 minutes.
        </li>
        <li>
          On the shop PC, open the agent&apos;s local status page at{" "}
          <code>http://127.0.0.1:7171</code>. It is only reachable from that PC.
        </li>
        <li>
          Enter the backend address and the pairing code and press pair. The agent generates an
          Ed25519 key pair and a device ID, and sends only the public key to the API.
        </li>
        <li>
          The page shows <strong>paired</strong> along with the business ID. The tray icon status
          changes and the printers appear in the Printers tab of the Shop app.
        </li>
      </ol>
      <Callout tone="warning" title="Codes are single use">
        <p>
          Reusing a code, or using one after it expires, is rejected with HTTP 410 (
          <code>PAIRING_CODE_CONSUMED</code>, <code>PAIRING_CODE_INVALID</code> or an expiry error).
          Issue a fresh code instead of retrying.
        </p>
      </Callout>
      <CodeBlock language="bash" label="Check the agent locally" code={statusExample} />

      <h2 id="running">Running on Windows</h2>
      <ul>
        <li>
          It runs as a per-user background app with a <strong>system tray icon</strong>. The menu
          shows the current status, an <strong>Open status page</strong> item and{" "}
          <strong>Exit</strong>.
        </li>
        <li>
          The Windows installer registers it to start automatically when you sign in (a per-user
          startup entry, not a Windows service), so keep that Windows user signed in on the shop PC.
        </li>
        <li>
          If the network drops, the agent keeps retrying with a growing delay (capped at five
          minutes) and resumes on its own.
        </li>
      </ul>

      <h2 id="how-it-works">How it works</h2>
      <p>
        The agent never holds a long-lived password. It proves who it is with a signature each
        session and receives a short-lived access token (15 minutes). Its endpoints are listed in
        the <Link href="/docs/api-reference#agents">API reference</Link>.
      </p>
      <CodeBlock language="text" label="Agent protocol" code={flowExample} />
      <p>
        The API returns the print configuration with each job (pages, copies, paper size, colour,
        sides). Status reports carry an <code>Idempotency-Key</code>, so a retry after a dropped
        connection is safe and never re-runs a transition.
      </p>
      <h3>What the agent reports</h3>
      <TableScroll label="Agent-reported states">
        <thead>
          <tr>
            <th scope="col">Report</th>
            <th scope="col">Values</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Printer health (heartbeat)</th>
            <td>
              <code>ONLINE</code>, <code>ERROR</code>
            </td>
            <td>
              Reachable and fine, or reachable with a fault. The API itself marks a printer{" "}
              <code>OFFLINE</code> when heartbeats stop.
            </td>
          </tr>
          <tr>
            <th scope="row">Job status</th>
            <td>
              <code>PRINTING</code>, <code>PRINTED</code>, <code>FAILED</code>, <code>UNKNOWN</code>
            </td>
            <td>
              <code>UNKNOWN</code> means the outcome of a submission could not be confirmed. The job
              is deliberately not retried automatically, so you never get a silent duplicate print.
            </td>
          </tr>
        </tbody>
      </TableScroll>

      <h2 id="files">Files and data</h2>
      <p>
        Everything lives in one folder, <code>%LOCALAPPDATA%\PrintAutomated</code>: the device
        identity (<code>identity.json</code>), a small job ledger (<code>ledger.sqlite</code>),
        rolling logs (<code>logs</code>) and temporary documents (<code>tmp</code>). Documents are
        fetched only for jobs assigned to this agent and are cleared from <code>tmp</code>{" "}
        afterwards. Back up or delete that folder to move or reset an installation; a reset agent
        needs a new pairing code.
      </p>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <TableScroll label="Troubleshooting">
        <thead>
          <tr>
            <th scope="col">Symptom</th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Printer shows offline</th>
            <td>
              Is the agent running (tray icon) and signed in? Heartbeats arrive every 30 seconds;
              the status page shows <code>lastHeartbeatAt</code> and <code>lastError</code>.
            </td>
          </tr>
          <tr>
            <th scope="row">Pairing fails</th>
            <td>
              Code typed wrongly, already used, or older than 10 minutes. Issue a new one. Pairing
              attempts are rate limited to 10 per minute per device.
            </td>
          </tr>
          <tr>
            <th scope="row">Jobs are not arriving</th>
            <td>
              The printer must be enabled and online, and automatic assignment on (or a job assigned
              by hand). A blocked job records why, for example <code>PRINTER_OFFLINE</code> or{" "}
              <code>NO_COMPATIBLE_PRINTER</code>.
            </td>
          </tr>
        </tbody>
      </TableScroll>
      <Callout tone="planned" title="Native agent in progress">
        <p>
          The agent described here is the current Node-based Windows build. A native C++ rewrite is
          under development to reach parity; the pairing flow and the API contract stay the same.
        </p>
      </Callout>
    </DocPage>
  );
}
