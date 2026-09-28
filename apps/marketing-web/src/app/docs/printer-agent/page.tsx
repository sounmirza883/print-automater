import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "Printer agent",
  description:
    "Install the Print Automated printer agent on Windows, pair it with a one-time code, and understand how it authenticates, polls for jobs, prints and reports status.",
  alternates: { canonical: "/docs/printer-agent" },
};

const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "requirements", label: "Requirements" },
  { id: "installing", label: "Installing" },
  { id: "pairing", label: "Pairing" },
  { id: "running", label: "Running on Windows" },
  { id: "printers", label: "Which printers it offers" },
  { id: "how-it-works", label: "How it works" },
  { id: "files", label: "Files and data" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const statusExample = `curl http://127.0.0.1:7171/api/status

{
  "paired": true,
  "pairing": false,
  "deviceId": "3f0c9d52-0000-4000-8000-000000000000",
  "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
  "lastHeartbeatAt": "2026-01-01T10:15:30.000Z",
  "printers": 2,
  "lastJob": "PRINTED at 2026-01-01T10:14:02.000Z",
  "lastError": "",
  "version": "0.1.0"
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
GET  /v1/agents/jobs?wait=20             # long-poll: 200 job | 204 nothing yet
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
        The agent is what turns an accepted order into paper. It reports the printers Windows can
        see and whether each one is healthy, waits for jobs assigned to it, downloads the document,
        prints it and reports the outcome. It is a native Windows program: documents are rendered in
        the agent itself and sent straight to the printer driver, with no other PDF software to
        install. Because the agent always calls out to the API, you do not need to open ports in
        your router or expose the PC to the internet.
      </p>

      <h2 id="requirements">Requirements</h2>
      <ul>
        <li>Windows 10 or 11 (64-bit) with the printers you want to use installed and working.</li>
        <li>
          A staff member who may manage printers to issue the pairing code (
          <code>MANAGE_PRINTERS</code>: the Owner, Manager and Printer manager roles).
        </li>
        <li>Outbound HTTPS access to your Print Automated API.</li>
      </ul>

      <h2 id="installing">Installing</h2>
      <p>
        Run the installer on the shop PC while signed in as the Windows user who will keep the
        printers running. It installs for that user only, so it does not ask for administrator
        rights, and it is already set up for your Print Automated address. When it finishes, the
        agent starts and opens its pairing page.
      </p>

      <h2 id="pairing">Pairing</h2>
      <p>Pairing links one PC to one business. It happens once.</p>
      <ol>
        <li>
          In the back office, open <strong>Printers</strong> and choose{" "}
          <strong>Pair a computer</strong>, then <strong>Show a pairing code</strong> (or call{" "}
          <code>POST /v1/shop/agents/pairing-code</code>). The code is 8 characters, avoids
          look-alike characters such as 0/O and 1/I/L, works once and expires after 10 minutes.
        </li>
        <li>
          On the shop PC, open the agent&apos;s page at <code>http://127.0.0.1:7171</code>: it opens
          after installing, or click the agent&apos;s icon near the clock. The page is only
          reachable from that PC.
        </li>
        <li>
          Type the code (capitals, spaces and dashes do not matter) and choose{" "}
          <strong>Pair this computer</strong>. The agent generates an Ed25519 key pair and a device
          ID, and sends only the public key to the API.
        </li>
        <li>
          The page shows <strong>Paired</strong>, and within about 30 seconds the computer&apos;s
          printers appear on the <strong>Printers</strong> page.
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
          It runs as a per-user app with an icon near the clock. Click it for the agent&apos;s page;
          right-click for the current status, <strong>Open agent page</strong> and{" "}
          <strong>Quit</strong>.
        </li>
        <li>
          It starts automatically when that Windows user signs in (a per-user startup entry, not a
          Windows service), so keep that user signed in on the shop PC. Only one agent runs per
          user.
        </li>
        <li>
          If the network drops, the agent keeps retrying with a growing delay (capped at five
          minutes for heartbeats, one minute for jobs) and resumes on its own.
        </li>
      </ul>

      <h2 id="printers">Which printers it offers</h2>
      <p>
        The agent reports each printer with what its Windows driver says it can do: colour,
        double-sided, A4 and A3. Staff can still correct these on the printer&apos;s page. It leaves
        out queues that cannot put paper in a tray without someone at the screen: fax queues,
        &ldquo;print to file&rdquo; queues such as Microsoft Print to PDF (they ask where to save),
        and queues whose output goes nowhere, such as Send To OneNote.
      </p>
      <p>
        Before printing, the agent asks the driver to apply the job&apos;s settings. If the driver
        cannot honour one the customer ordered (double-sided, the paper size or colour), the job is
        refused and reported <code>FAILED</code> with the reason, before anything prints, rather
        than printed differently.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <p>
        The agent never holds a long-lived password. It proves who it is with a signature each
        session and receives a short-lived access token (15 minutes). Its endpoints are listed in
        the <Link href="/docs/api-reference#agents">API reference</Link>.
      </p>
      <CodeBlock language="text" label="Agent protocol" code={flowExample} />
      <p>
        The API returns the print configuration with each job (pages, copies, paper size, colour,
        sides, orientation). Pages print at their actual size. Status reports carry an{" "}
        <code>Idempotency-Key</code>, so a retry after a dropped connection is safe and never
        re-runs a transition.
      </p>
      <p>
        Every claimed job is written to a local ledger on disk <em>before</em> it is printed. If the
        PC loses power or the agent is closed part way through, the job is marked{" "}
        <code>UNKNOWN</code> and reported when the agent starts again, and it is never printed a
        second time on its own.
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
              Reachable and fine, or reachable with a fault (paper jam, out of paper, offline in
              Windows). The API itself marks a printer <code>OFFLINE</code> when heartbeats stop.
            </td>
          </tr>
          <tr>
            <th scope="row">Job status</th>
            <td>
              <code>PRINTING</code>, <code>PRINTED</code>, <code>FAILED</code>, <code>UNKNOWN</code>
            </td>
            <td>
              <code>FAILED</code> is only reported when nothing more can print (the job never
              reached the printer, or was removed from its queue). <code>UNKNOWN</code> means paper
              may exist, for example after a jam: someone checks the printer, and the job is never
              retried automatically, so you never get a silent duplicate print.
            </td>
          </tr>
        </tbody>
      </TableScroll>

      <h2 id="files">Files and data</h2>
      <p>
        Everything lives in one folder, <code>%LOCALAPPDATA%\PrintAutomated</code>: the settings (
        <code>config.json</code>), the device identity (<code>identity.dat</code>, locked with
        Windows so only this user on this PC can read the key), a small job ledger (
        <code>ledger.sqlite</code>), daily logs (<code>logs</code>, kept 14 days) and documents
        while they print (<code>tmp</code>, readable only by this user and deleted once printed).
        Documents are fetched only for jobs assigned to this agent. Uninstalling removes the folder;
        a reset agent needs a new pairing code.
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
              Is the agent running (icon near the clock) and the user signed in? Heartbeats arrive
              every 30 seconds; the agent&apos;s page shows the last heartbeat and any problem.
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
            <th scope="row">A printer is missing</th>
            <td>
              Fax, print-to-file and Send To OneNote queues are left out on purpose. Otherwise check
              that Windows can print a test page to it.
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
          <tr>
            <th scope="row">A job failed with &ldquo;This printer cannot&hellip;&rdquo;</th>
            <td>
              The driver refused a setting the order needs. Send it to a printer that can, or
              correct that printer&apos;s capabilities so it is not chosen for such jobs.
            </td>
          </tr>
          <tr>
            <th scope="row">&ldquo;Port 7171 is already in use&rdquo;</th>
            <td>Another agent is already running for this PC: quit it from its icon first.</td>
          </tr>
        </tbody>
      </TableScroll>
    </DocPage>
  );
}
