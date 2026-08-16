/* ==========================================================================
   Vivaha AI — UI wiring: form, pipeline status, agent cards, plan package.
   ========================================================================== */
"use strict";

(function () {
  const state = {
    running: false,
    results: null,
    toolCalls: [],
  };

  /* ------------------------- session persistence ------------------------ */

  function remember() {
    try {
      sessionStorage.setItem("vivaha:apiKey", $("api-key").value);
      sessionStorage.setItem("vivaha:sheet", $("sheet-url").value);
    } catch (_) {}
  }
  function recall() {
    try {
      if (!$("api-key").value) $("api-key").value = sessionStorage.getItem("vivaha:apiKey") || "";
      if (!$("sheet-url").value) $("sheet-url").value = sessionStorage.getItem("vivaha:sheet") || "";
    } catch (_) {}
  }

  /* ----------------------------- init ----------------------------------- */

  function initModelSelect() {
    const sel = $("model");
    MODELS.forEach((m) => {
      const o = document.createElement("option");
      o.value = m; o.textContent = m;
      if (m === DEFAULT_MODEL) o.selected = true;
      sel.appendChild(o);
    });
  }

  /* --------------------------- agent cards ------------------------------ */

  function agentCard(key) {
    const a = AGENTS[key];
    const card = document.createElement("article");
    card.className = "agent-card";
    card.id = "card-" + key;
    card.dataset.key = key;
    card.style.setProperty("--accent", a.color);
    card.innerHTML =
      '<header class="agent-head">' +
        '<div class="avatar" style="background:' + a.color + '">' + a.emoji + '</div>' +
        '<div class="agent-id">' +
          '<h3>' + esc(a.name) + ' <span class="archetype">' + esc(a.archetype) + '</span></h3>' +
          '<p class="agent-title">' + esc(a.title) + '</p>' +
        '</div>' +
        '<div class="agent-state" data-state="idle">' +
          '<span class="state-dot"></span><span class="state-label">waiting</span>' +
        '</div>' +
      '</header>' +
      '<p class="superpower"><span>Superpower</span> ' + esc(a.superpower) + ' · <span>Produces</span> ' + esc(a.produces) + '</p>' +
      '<details class="prompt"><summary>View system prompt</summary><pre>' + esc(a.systemPrompt) + '</pre></details>' +
      '<div class="agent-output"></div>' +
      '<div class="tool-evidence" hidden></div>';
    $("outputs-container").appendChild(card);
    return card;
  }

  function setAgentState(key, status, label) {
    const card = $("card-" + key);
    if (!card) return;
    const s = card.querySelector(".agent-state");
    s.dataset.state = status;
    s.querySelector(".state-label").textContent = label;
    const node = document.querySelector('.node[data-key="' + key + '"]');
    if (node) node.classList.toggle("active", status === "running");
    if (node) node.classList.toggle("done", status === "done");
    if (node) node.classList.toggle("error", status === "error");
  }

  function setAgentOutput(key, html) {
    const card = $("card-" + key);
    if (!card) return;
    card.querySelector(".agent-output").innerHTML = html;
  }

  function setToolEvidence(key, toolCalls) {
    const card = $("card-" + key);
    if (!card) return;
    const box = card.querySelector(".tool-evidence");
    if (!toolCalls || !toolCalls.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = toolCalls.map((tc) => {
      const rows = tc.result && tc.result.rows;
      const n = Array.isArray(rows) ? rows.length : null;
      const fetchedAt = tc.result && tc.result.fetchedAt;
      return '<div class="tool-line">' +
        '<span class="tool-name">⚡ ' + esc(tc.name) + '</span>' +
        '<span class="tool-args">' + esc(JSON.stringify(tc.args || {})) + '</span>' +
        '<span class="tool-result">' +
          (n != null ? '→ fetched <strong>' + n + ' vendors</strong> live from Google Sheets' : '→ executed') +
          (fetchedAt ? ' at ' + esc(new Date(fetchedAt).toLocaleTimeString()) : '') +
        '</span></div>';
    }).join("");
  }

  /* ---------------------------- evidence -------------------------------- */

  function renderEvidence() {
    const live = state.toolCalls.find((tc) => tc.name === "fetch_live_vendor_database");
    if (!live) return;
    $("evidence").hidden = false;
    const total = live.result && live.result.total;
    const fetchedAt = live.result && live.result.fetchedAt;
    $("evidence-body").innerHTML =
      '<p class="ok">🟢 <strong>Live query confirmed.</strong> The Researcher agent called <code>fetch_live_vendor_database</code> at run time and read the vendor marketplace (a public Google Sheet) directly — ' +
      (total != null ? "<strong>" + total + " vendor records</strong> available" : "vendor records") +
      (fetchedAt ? " at " + esc(new Date(fetchedAt).toLocaleTimeString()) : "") +
      ". No vendor data is hardcoded in this codebase.</p>" +
      '<pre class="json">' + esc(JSON.stringify(live.result.rows.slice(0, 3), null, 2)) + '\n… (truncated)</pre>';
  }

  /* --------------------------- plan package ----------------------------- */

  function renderPackage() {
    const plan = state.results && state.results.maker && state.results.maker.plan;
    if (!plan) {
      $("package").hidden = false;
      $("package-body").innerHTML = '<p class="warn">⚠ The Maker returned a response, but it could not be parsed as JSON. Its raw output is shown in the Maker card.</p>';
      return;
    }
    $("package").hidden = false;
    $("package-body").innerHTML = renderPlan(plan);
  }

  function downloadJson() {
    const plan = state.results && state.results.maker && state.results.maker.plan;
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vivaha-wedding-plan.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyJson() {
    const plan = state.results && state.results.maker && state.results.maker.plan;
    if (!plan) return;
    navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
    const b = $("copy-btn");
    b.textContent = "Copied ✓";
    setTimeout(() => { b.textContent = "Copy JSON"; }, 1500);
  }

  /* ----------------------------- run ----------------------------------- */

  async function onRun(e) {
    e.preventDefault();
    if (state.running) return;
    let apiKey, sheet;
    if (usingBackend()) {
      apiKey = "backend";
      sheet = "backend";
    } else {
      apiKey = $("api-key").value.trim();
      sheet = $("sheet-url").value.trim();
      if (!apiKey || !sheet) { setStatus("Direct mode needs both a Gemini API key and a Google Sheet URL.", true); return; }
      remember();
    }

    state.running = true;
    state.toolCalls = [];
    $("run-btn").disabled = true;
    $("run-btn").textContent = "Agents working…";
    setStatus("Running the pipeline…", false);

    $("outputs-container").innerHTML = "";
    $("package").hidden = true;
    $("evidence").hidden = true;
    AGENT_ORDER.forEach((k) => { agentCard(k); setAgentState(k, "idle", "waiting"); });

    const brief = {
      couple: $("couple").value.trim(),
      city: $("city").value.trim(),
      date: $("date").value,
      budget: Number($("budget").value),
      guests: Number($("guests").value),
      style: $("style").value.trim(),
      priorities: $("priorities").value.trim(),
      notes: $("notes").value.trim(),
    };

    const hooks = {
      onAgent: (key) => setAgentState(key, "running", "working…"),
      onDone: (key, res) => {
        setAgentState(key, "done", "done");
        if (key === "maker") {
          setAgentOutput(key, res.plan
            ? '<div class="json-ok">✓ Valid JSON artefact — rendered below in section 4.</div>'
            : '<pre class="json">' + esc(res.text) + "</pre>");
        } else {
          setAgentOutput(key, renderMarkdown(res.text));
        }
        setToolEvidence(key, res.toolLog);
        if (res.toolLog) state.toolCalls.push(...res.toolLog);
        if (key === "maker") renderPackage();
        if (key === "manager") renderEvidence();
      },
      onError: (key, e) => {
        setAgentState(key, "error", "failed");
        setAgentOutput(key, '<p class="warn">⚠ ' + esc(String(e.message || e)) + "</p>");
      },
    };

    try {
      state.results = await runPipeline({ model: $("model").value, apiKey, sheet, brief }, hooks);
      setStatus("Done in " + ((state.results._meta.elapsedMs / 1000) || 0).toFixed(1) + "s — all five agents handed off successfully.", false);
    } catch (e) {
      setStatus("Pipeline stopped: " + (e.message || e), true);
    } finally {
      state.running = false;
      $("run-btn").disabled = false;
      $("run-btn").textContent = "▶ Run the agentic pipeline";
    }
  }

  function setStatus(msg, isErr) {
    const el = $("setup-status");
    el.textContent = msg;
    el.classList.toggle("error", !!isErr);
  }

  /* ----------------------------- bind ---------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    initModelSelect();
    recall();
    setModeNote();
    $("config-form").addEventListener("submit", onRun);
    $("download-btn").addEventListener("click", downloadJson);
    $("copy-btn").addEventListener("click", copyJson);
    $("api-key").addEventListener("input", remember);
    $("sheet-url").addEventListener("input", remember);
  });

  function setModeNote() {
    const note = $("mode-note");
    if (usingBackend()) {
      note.innerHTML = "";
      note.hidden = true;
      $("advanced").hidden = true;
    } else {
      note.innerHTML = '⚠ <strong>Backend not configured.</strong> Set <code>API_BASE</code> in <code>config.js</code> after deploying the backend to Render. Until then, use "Advanced" below to supply a Gemini key + Google Sheet directly (local testing).';
      $("advanced").open = true;
    }
  }
})();
