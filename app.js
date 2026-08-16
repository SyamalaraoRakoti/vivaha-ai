/* ==========================================================================
   Vivaha AI — Agentic Wedding Planning Organisation
   Orchestration layer: Gemini function-calling, live Google Sheets data,
   and the 5-agent pipeline (Researcher → Designer → Maker → Communicator → Manager).
   ========================================================================== */
"use strict";

/* ------------------------------ constants ------------------------------- */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-flash-latest"];
const DEFAULT_MODEL = "gemini-3.6-flash";

/* True when a hosted backend (Render) is configured. When true, the Gemini key
   and the Google Sheet live server-side and visitors need nothing to run it. */
function usingBackend() {
  return !!(typeof CONFIG !== "undefined" && CONFIG.USE_BACKEND && CONFIG.API_BASE && CONFIG.API_BASE.indexOf("YOUR") !== 0);
}

/* ----------------------------- small helpers ---------------------------- */

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN");
}

/* ------------------------- Google Sheets (live data) --------------------- */
/* Reads a PUBLIC Google Sheet at query time via the gviz JSONP endpoint,
   which works cross-origin without an API key. The data is never hardcoded. */

function extractSheetId(input) {
  if (!input) return null;
  input = String(input).trim();
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(input)) return input;
  return null;
}

function parseGviz(resp) {
  const table = (resp && resp.table) || {};
  const cols = (table.cols || []).map((c) => c.label || c.id || "");
  return (table.rows || []).map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => {
      const key = cols[i] || "col" + i;
      obj[key] = cell && cell.v !== undefined && cell.v !== null
        ? cell.v
        : (cell && cell.f != null ? cell.f : "");
    });
    return obj;
  });
}

function fetchGoogleSheet(sheetInput) {
  return new Promise((resolve, reject) => {
    const id = extractSheetId(sheetInput);
    if (!id) {
      return reject(new Error(
        "Could not find a Google Sheet ID in that input. Paste the sheet's share URL (containing /spreadsheets/d/<ID>/) or the raw ID."
      ));
    }
    const cb = "__vivaha_sheet_" + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out loading the Google Sheet.")); }, 25000);
    function cleanup() { delete window[cb]; clearTimeout(timeout); }
    window[cb] = function (resp) {
      cleanup();
      try {
        if (resp && resp.status === "error") {
          throw new Error((resp.errors || []).map((e) => e.message).join("; ") || "Google returned an error for this sheet.");
        }
        resolve({ rows: parseGviz(resp), fetchedAt: new Date().toISOString() });
      } catch (e) { reject(e); }
    };
    const url = "https://docs.google.com/spreadsheets/d/" + id + "/gviz/tq?tqx=out:json&tqx=responseHandler:" + cb;
    const s = document.createElement("script");
    s.src = url;
    s.onerror = () => { cleanup(); reject(new Error("Could not reach Google Sheets. Make sure the sheet is shared as \"Anyone with the link — Viewer\".")); };
    document.head.appendChild(s);
  });
}

async function fetchVendorData(sheetInput, args) {
  if (usingBackend()) {
    const params = new URLSearchParams();
    if (args && args.category) params.set("category", args.category);
    if (args && args.city) params.set("city", args.city);
    const res = await backendFetch(CONFIG.API_BASE + "/api/vendors?" + params.toString());
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j && j.error) || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }
  // Fallback (local direct mode): read the sheet via the gviz JSONP endpoint.
  const { rows, fetchedAt } = await fetchGoogleSheet(sheetInput);
  let out = rows;
  const category = args && args.category;
  const city = args && args.city;
  if (category) {
    const c = String(category).toLowerCase();
    out = out.filter((r) => String(r.category || "").toLowerCase().includes(c));
  }
  if (city) {
    const c = String(city).toLowerCase();
    out = out.filter((r) => String(r.city || "").toLowerCase().includes(c));
  }
  return { rows: out, total: rows.length, fetchedAt };
}

/* ------------------------------ Gemini API ------------------------------ */

/* Retries transient network failures (e.g. Render's free-tier cold start) so
   a single "Load failed" / "Failed to fetch" does not kill the whole run. */
async function backendFetch(url, opts, retries) {
  if (retries == null) retries = 3;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function callGemini(model, apiKey, body) {
  if (usingBackend()) {
    const res = await backendFetch(CONFIG.API_BASE + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model, ...body }),
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j && j.error) || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }
  const url = GEMINI_BASE + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { const j = await res.json(); msg = (j && j.error && j.error.message) || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function geminiError(resp) {
  if (!resp) return "Empty response from Gemini.";
  if (resp.error && resp.error.message) return resp.error.message;
  if (resp.promptFeedback && resp.promptFeedback.blockReason) {
    return "Blocked: " + resp.promptFeedback.blockReason;
  }
  return "Unexpected Gemini response structure.";
}

/* Function-calling aware runner. Executes tools the model requests, feeding
   the live results back until the model produces its final text answer. */
async function runAgentTurn({ model, apiKey, systemPrompt, userPrompt, tools, toolExecutors, responseJson, onToolCall }) {
  const contents = [{ role: "user", parts: [{ text: userPrompt }] }];
  const toolLog = [];
  const bodyBase = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
  };
  if (tools && tools.length) bodyBase.tools = [{ functionDeclarations: tools }];
  if (responseJson) {
    bodyBase.generationConfig = { responseMimeType: "application/json", maxOutputTokens: 16384 };
  } else {
    bodyBase.generationConfig = { maxOutputTokens: 8192 };
  }

  let iterations = 8;
  while (iterations-- > 0) {
    const resp = await callGemini(model, apiKey, bodyBase);
    const cand = resp.candidates && resp.candidates[0];
    if (!cand || !cand.content) {
      const e = geminiError(resp);
      throw new Error(e);
    }
    const parts = cand.content.parts || [];
    const fnParts = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => typeof p.text === "string");

    if (fnParts.length === 0) {
      return { text: textParts.map((p) => p.text).join("\n").trim(), toolLog, finishReason: cand.finishReason };
    }

    // Execute the requested function(s) — this is the live data access.
    const fnCallParts = [];
    const responseParts = [];
    for (const p of fnParts) {
      const name = p.functionCall.name;
      const args = p.functionCall.args || {};
      fnCallParts.push(p);
      let result;
      try {
        result = toolExecutors && toolExecutors[name]
          ? await toolExecutors[name](args)
          : { error: "No executor for tool: " + name };
      } catch (e) {
        result = { error: String((e && e.message) || e) };
      }
      toolLog.push({ name, args, result });
      if (onToolCall) onToolCall({ name, args, result });
      responseParts.push({
        functionResponse: { name, response: { result: JSON.stringify(result) } },
      });
    }
    bodyBase.contents.push({ role: "model", parts: fnCallParts });
    bodyBase.contents.push({ role: "user", parts: responseParts });
  }
  throw new Error("Tool-call loop exceeded maximum iterations.");
}

/* ----------------------------- Markdown render -------------------------- */

function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function renderTable(buf) {
  if (buf.length < 2) return "<p>" + buf.map(inlineMd).join("<br>") + "</p>";
  const header = buf[0].split("|").map((c) => c.trim()).filter((c) => c !== "");
  const rows = buf.slice(2).filter((r) => r.trim() && !/^\s*\|?\s*[\s:|-]+\s*\|?\s*$/.test(r.trim()));
  let t = '<div class="table-wrap"><table><thead><tr>';
  header.forEach((h) => { t += "<th>" + inlineMd(h) + "</th>"; });
  t += "</tr></thead><tbody>";
  rows.forEach((r) => {
    let cells = r.split("|");
    if (cells.length && cells[0].trim() === "") cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
    t += "<tr>";
    header.forEach((_, i) => { t += "<td>" + inlineMd((cells[i] || "").trim()) + "</td>"; });
    t += "</tr>";
  });
  t += "</tbody></table></div>";
  return t;
}

function renderMarkdown(md) {
  if (!md) return "";
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  let html = "", inCode = false, codeBuf = [], inList = null, tableBuf = [], inTable = false;
  const closeList = () => { if (inList) { html += "</" + inList + ">"; inList = null; } };
  const closeTable = () => { if (inTable) { html += renderTable(tableBuf); tableBuf = []; inTable = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (!inCode) { closeList(); closeTable(); inCode = true; codeBuf = []; }
      else { html += "<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>"; inCode = false; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); inTable = true; tableBuf.push(line); continue; }
    if (inTable) closeTable();

    let m = line.match(/^(#{1,6})\s+(.*)/);
    if (m) { closeList(); closeTable(); html += "<h" + m[1].length + ">" + inlineMd(m[2]) + "</h" + m[1].length + ">"; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); closeTable(); html += "<hr>"; continue; }
    m = line.match(/^\s*[-*+]\s+(.*)/);
    if (m) { closeTable(); if (inList !== "ul") { closeList(); html += "<ul>"; inList = "ul"; } html += "<li>" + inlineMd(m[1]) + "</li>"; continue; }
    m = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (m) { closeTable(); if (inList !== "ol") { closeList(); html += "<ol>"; inList = "ol"; } html += "<li>" + inlineMd(m[1]) + "</li>"; continue; }
    m = line.match(/^\s*>\s?(.*)/);
    if (m) { closeList(); closeTable(); html += "<blockquote>" + inlineMd(m[1]) + "</blockquote>"; continue; }
    if (line.trim() === "") { closeList(); closeTable(); continue; }
    closeList(); closeTable();
    html += "<p>" + inlineMd(line) + "</p>";
  }
  closeList(); closeTable();
  if (inCode) html += "<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>";
  return html;
}

/* --------------------------- plan JSON rendering ------------------------ */

function safeParseJson(text) {
  if (!text) return null;
  let t = String(text).replace(/^\uFEFF/, "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) t = t.slice(first, last + 1);
  t = t.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(t); } catch (_) { return null; }
}

function renderPlan(plan) {
  if (!plan) return "";
  let h = "";
  if (plan.summary) h += "<p class=\"plan-summary\">" + esc(plan.summary) + "</p>";
  if (plan.budget) {
    h += "<h3>Budget</h3><div class=\"table-wrap\"><table><thead><tr><th>Category</th><th>Amount</th><th>%</th><th>Notes</th></tr></thead><tbody>";
    (plan.budget.allocations || []).forEach((a) => {
      h += "<tr><td>" + esc(a.category) + "</td><td>" + fmt(a.amount) + "</td><td>" + esc(a.pct) + "%</td><td>" + esc(a.notes || "") + "</td></tr>";
    });
    h += "<tr class=\"total\"><td>Contingency</td><td>" + fmt(plan.budget.contingency) + "</td><td>—</td><td></td></tr>";
    h += "<tr class=\"total\"><td>Total</td><td>" + fmt(plan.budget.total) + "</td><td>100%</td><td>" + esc(plan.budget.currency || "INR") + "</td></tr>";
    h += "</tbody></table></div>";
  }
  if (plan.vendors && plan.vendors.length) {
    h += "<h3>Vendor Shortlist</h3><div class=\"table-wrap\"><table><thead><tr><th>Category</th><th>Vendor</th><th>City</th><th>Price</th><th>Rating</th></tr></thead><tbody>";
    plan.vendors.forEach((v) => {
      h += "<tr><td>" + esc(v.category) + "</td><td><strong>" + esc(v.name) + "</strong><div class=\"muted\">" + esc(v.reason || "") + "</div></td><td>" + esc(v.city || "") + "</td><td>" + esc(v.price || "") + "</td><td>" + esc(v.rating != null ? v.rating : "") + " ★</td></tr>";
    });
    h += "</tbody></table></div>";
  }
  if (plan.itinerary && plan.itinerary.length) {
    h += "<h3>Itinerary</h3>";
    plan.itinerary.forEach((d) => {
      h += "<div class=\"itin-day\"><h4>" + esc(d.day || "Day") + "</h4>";
      (d.events || []).forEach((e) => {
        h += "<div class=\"itin-event\"><span class=\"time\">" + esc(e.time || "") + "</span><span>" + esc(e.event || "") + "</span><span class=\"muted\">" + esc(e.location || "") + (e.notes ? " — " + esc(e.notes) : "") + "</span></div>";
      });
      h += "</div>";
    });
  }
  if (plan.checklist && plan.checklist.length) {
    h += "<h3>Checklist</h3><ul class=\"checklist\">" + plan.checklist.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul>";
  }
  if (plan.risks && plan.risks.length) {
    h += "<h3>Risks</h3><div class=\"table-wrap\"><table><thead><tr><th>Risk</th><th>Impact</th><th>Mitigation</th></tr></thead><tbody>";
    plan.risks.forEach((r) => { h += "<tr><td>" + esc(r.risk) + "</td><td>" + esc(r.impact || "") + "</td><td>" + esc(r.mitigation || "") + "</td></tr>"; });
    h += "</tbody></table></div>";
  }
  return h;
}

/* ------------------------------ pipeline -------------------------------- */

function buildBriefText(b) {
  return [
    "Couple: " + (b.couple || "TBD"),
    "City: " + (b.city || "TBD"),
    "Wedding date: " + (b.date || "TBD"),
    "Total budget (INR): " + (b.budget ? Number(b.budget).toLocaleString("en-IN") : "TBD"),
    "Guest count: " + (b.guests || "TBD"),
    "Style / vision: " + (b.style || "TBD"),
    "Top priorities: " + (b.priorities || "TBD"),
    "Special notes: " + (b.notes || "None"),
  ].join("\n");
}

async function runAgent(agent, { model, apiKey, briefText, priorContext, toolConfig, onToolCall }) {
  const prompt = "# Client brief\n" + briefText +
    (priorContext ? "\n\n# Work from earlier agents\n" + priorContext : "") +
    "\n\nNow complete your task as instructed in your system prompt.";

  return runAgentTurn({
    model,
    apiKey,
    systemPrompt: agent.systemPrompt,
    userPrompt: prompt,
    tools: toolConfig ? toolConfig.tools : undefined,
    toolExecutors: toolConfig ? toolConfig.executors : undefined,
    responseJson: toolConfig ? toolConfig.responseJson : undefined,
    onToolCall,
  });
}

async function runPipeline(cfg, hooks) {
  const { model, apiKey, sheet, brief, stopAt } = cfg;
  const briefText = buildBriefText(brief);
  const out = {};
  let context = "";
  const start = performance.now();

  const run = async (key, agent, toolConfig) => {
    hooks && hooks.onAgent && hooks.onAgent(key);
    try {
      const res = await runAgent(agent, {
        model, apiKey, briefText, priorContext: context, toolConfig,
        onToolCall: hooks && hooks.onToolCall,
      });
      out[key] = res;
      context += "\n\n## " + agent.archetype + " Output (" + agent.name + ")\n" + res.text + "\n";
      hooks && hooks.onDone && hooks.onDone(key, res);
      return res;
    } catch (e) {
      hooks && hooks.onError && hooks.onError(key, e);
      throw e;
    }
  };

  const runMaker = async () => {
    hooks && hooks.onAgent && hooks.onAgent("maker");
    try {
      let mk = await runAgent(AGENTS.maker, { model, apiKey, briefText, priorContext: context, toolConfig: { responseJson: true } });
      let plan = safeParseJson(mk.text);
      if (!plan) {
        const fixCtx = context +
          "\n\n## IMPORTANT FIX INSTRUCTION\nYour previous output was not valid JSON (it may have been truncated). " +
          "Return ONLY a complete, valid JSON object matching the exact schema in your system prompt. " +
          "Close every brace and bracket. No markdown, no comments, no trailing text.";
        mk = await runAgent(AGENTS.maker, { model, apiKey, briefText, priorContext: fixCtx, toolConfig: { responseJson: true } });
        plan = safeParseJson(mk.text);
      }
      out.maker = mk;
      out.maker.plan = plan;
      context += "\n\n## Wedding Plan (Ravi)\n" + mk.text + "\n";
      hooks && hooks.onDone && hooks.onDone("maker", mk);
    } catch (e) {
      hooks && hooks.onError && hooks.onError("maker", e);
      throw e;
    }
  };

  const steps = [
    { key: "researcher", agent: AGENTS.researcher, toolConfig: { tools: [VENDOR_TOOL_DECLARATION], executors: { fetch_live_vendor_database: (args) => fetchVendorData(sheet, args) } } },
    { key: "designer", agent: AGENTS.designer, toolConfig: undefined },
    { key: "maker", agent: AGENTS.maker, toolConfig: undefined },
    { key: "communicator", agent: AGENTS.communicator, toolConfig: undefined },
    { key: "manager", agent: AGENTS.manager, toolConfig: undefined },
  ];

  const stopIdx = stopAt
    ? Math.max(0, steps.findIndex((s) => s.key === stopAt))
    : steps.length - 1;

  for (let i = 0; i <= stopIdx; i++) {
    const s = steps[i];
    if (s.key === "maker") await runMaker();
    else await run(s.key, s.agent, s.toolConfig);
  }

  out._meta = { elapsedMs: Math.round(performance.now() - start), finishedAt: new Date().toISOString() };
  return out;
}
