#include "server/pairing_page.h"

namespace pa {

const std::string& pairing_page_html() {
  static const std::string html = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Print Automated agent</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main>
  <header>
    <h1>Print Automated agent</h1>
    <span id="state" class="badge">Loading</span>
  </header>

  <section class="card" id="details" hidden>
    <dl>
      <dt>Shop</dt><dd id="shop"></dd>
      <dt>This computer</dt><dd id="device"></dd>
      <dt>Last heartbeat</dt><dd id="heartbeat"></dd>
      <dt>Printers found</dt><dd id="printers"></dd>
      <dt>Last job</dt><dd id="last-job"></dd>
    </dl>
  </section>

  <p class="problem" id="problem" role="alert" hidden></p>

  <form class="card" id="pair-form" hidden>
    <label for="code">Pairing code</label>
    <p class="hint">In the Print Automated app, open Printers and choose Pair a computer. Enter the 8-character code it shows.</p>
    <input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" required>
    <button id="pair-button" type="submit">Pair this computer</button>
    <p class="problem" id="pair-error" role="alert"></p>
  </form>

  <footer>Version <span id="version"></span>. This page is only reachable from this computer.</footer>
</main>
<script src="/app.js"></script>
</body>
</html>
)HTML";
  return html;
}

const std::string& pairing_page_js() {
  static const std::string js = R"JS("use strict";
const $ = (id) => document.getElementById(id);

function when(iso) {
  if (!iso) return "Not yet";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

async function refresh() {
  let s;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    s = await response.json();
  } catch {
    $("state").textContent = "Not responding";
    $("state").className = "badge bad";
    return;
  }
  $("state").textContent = s.paired ? "Paired" : s.pairing ? "Pairing" : "Not paired";
  $("state").className = s.paired ? "badge ok" : "badge";
  $("details").hidden = !s.paired;
  $("shop").textContent = s.shopId || "";
  $("device").textContent = s.deviceId || "";
  $("heartbeat").textContent = when(s.lastHeartbeatAt);
  $("printers").textContent = String(s.printers);
  $("last-job").textContent = s.lastJob || "None yet";
  $("problem").hidden = !s.lastError;
  $("problem").textContent = s.lastError || "";
  $("pair-form").hidden = s.paired;
  $("version").textContent = s.version || "";
}

$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("pair-button");
  const error = $("pair-error");
  error.textContent = "";
  button.disabled = true;
  try {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: $("code").value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      error.textContent = body.message || "Pairing failed.";
    } else {
      $("code").value = "";
    }
  } catch {
    error.textContent = "The agent is not responding.";
  } finally {
    button.disabled = false;
    refresh();
  }
});

refresh();
setInterval(refresh, 2000);
)JS";
  return js;
}

const std::string& pairing_page_css() {
  static const std::string css = R"CSS(:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --border: #d9dde3;
  --text: #16181d;
  --muted: #5b6270;
  --accent: #2563eb;
  --accent-text: #ffffff;
  --ok: #0f7a3d;
  --ok-bg: #e3f4ea;
  --bad: #b3261e;
  --bad-bg: #fbe9e7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317;
    --surface: #1a1d23;
    --border: #2e333c;
    --text: #e8eaee;
    --muted: #9aa1ad;
    --accent: #5b8def;
    --accent-text: #0b0d10;
    --ok: #6fd39a;
    --ok-bg: #173324;
    --bad: #f2a29b;
    --bad-bg: #3a1c1a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 "Segoe UI", system-ui, sans-serif;
}
main { max-width: 520px; margin: 48px auto; padding: 0 16px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
.badge {
  font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
  background: var(--border); color: var(--text); white-space: nowrap;
}
.badge.ok { background: var(--ok-bg); color: var(--ok); }
.badge.bad { background: var(--bad-bg); color: var(--bad); }
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 20px; margin-bottom: 16px;
}
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
label { font-weight: 600; display: block; }
.hint { color: var(--muted); margin: 4px 0 12px; }
input {
  width: 100%; font: 600 20px/1.2 ui-monospace, Consolas, monospace; letter-spacing: 0.2em;
  text-transform: uppercase; padding: 10px 12px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); color: var(--text); margin-bottom: 12px;
}
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button {
  font: inherit; font-weight: 600; padding: 10px 18px; border: 0; border-radius: 8px;
  background: var(--accent); color: var(--accent-text); cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: progress; }
.problem { color: var(--bad); margin: 12px 0 0; }
.problem:empty { display: none; }
p.problem#problem { background: var(--bad-bg); padding: 12px 14px; border-radius: 8px; margin: 0 0 16px; }
footer { color: var(--muted); font-size: 13px; }
)CSS";
  return css;
}

}  // namespace pa
