/* ==========================================================================
   Vivaha AI — UI wiring: tabs, pipeline status, agent cards, plan package,
   vendor marketplace and individual agent runs.
   ========================================================================== */
"use strict";

(function () {
  const state = {
    running: false,
    results: null,
    marketRows: [],
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

  function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = true; });
        $("tab-" + t.dataset.tab).hidden = false;
        if (t.dataset.tab === "marketplace" && !state.marketRows.length) loadMarketplace();
      });
    });
  }

  /* --------------------------- config helpers --------------------------- */

  function getConfig() {
    if (usingBackend()) return { model: $("model").value, apiKey: "backend", sheet: "backend" };
    const apiKey = $("api-key").value.trim();
    const sheet = $("sheet-url").value.trim();
    if (!apiKey || !sheet) return null;
    remember();
    return { model: $("model").value, apiKey, sheet };
  }

  function readBrief() {
    return {
      couple: $("couple").value.trim(),
      city: $("city").value.trim(),
      date: $("date").value,
      budget: Number($("budget").value),
      guests: Number($("guests").value),
      style: $("style").value.trim(),
      priorities: $("priorities").value.trim(),
      notes: $("notes").value.trim(),
    };
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

  function renderToolNote(toolCalls) {
    if (!toolCalls || !toolCalls.length) return "";
    return toolCalls.map((tc) => {
      const n = tc.result && Array.isArray(tc.result.rows) ? tc.result.rows.length : null;
      return '<div class="tool-line"><span class="tool-name">⚡ ' + esc(tc.name) + '</span>' +
        (n != null ? '<span class="tool-result">→ fetched <strong>' + n + ' vendors</strong> live from Google Sheets</span>' : '') + '</div>';
    }).join("");
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

  /* --------------------------- full pipeline ---------------------------- */

  async function onRun(e) {
    e.preventDefault();
    if (state.running) return;
    const cfg = getConfig();
    if (!cfg) { setStatus("Direct mode needs both a Gemini API key and a Google Sheet URL.", true); return; }

    state.running = true;
    $("run-btn").disabled = true;
    $("run-btn").textContent = "Agents working…";
    setStatus("Running the pipeline…", false);

    $("outputs-container").innerHTML = "";
    $("package").hidden = true;
    AGENT_ORDER.forEach((k) => { agentCard(k); setAgentState(k, "idle", "waiting"); });

    const hooks = {
      onAgent: (key) => setAgentState(key, "running", "working…"),
      onDone: (key, res) => {
        setAgentState(key, "done", "done");
        if (key === "maker") {
          setAgentOutput(key, res.plan
            ? '<div class="json-ok">✓ Valid JSON artefact:</div>' + renderPlan(res.plan)
            : '<pre class="json">' + esc(res.text) + "</pre>");
        } else {
          setAgentOutput(key, renderMarkdown(res.text));
        }
        setToolEvidence(key, res.toolLog);
        if (key === "maker") renderPackage();
      },
      onError: (key, e) => {
        setAgentState(key, "error", "failed");
        setAgentOutput(key, '<p class="warn">⚠ ' + esc(String(e.message || e)) + "</p>");
      },
    };

    try {
      state.results = await runPipeline({ model: cfg.model, apiKey: cfg.apiKey, sheet: cfg.sheet, brief: readBrief() }, hooks);
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

  /* -------------------------- vendor marketplace ------------------------ */

  async function loadMarketplace() {
    const sheet = usingBackend() ? "backend" : $("sheet-url").value.trim();
    const status = $("mkt-status");
    status.classList.remove("error");
    status.textContent = "Loading live vendor directory…";
    try {
      const { rows, total, fetchedAt } = await fetchVendorData(sheet, {});
      state.marketRows = rows;
      populateMarketFilters(rows);
      applyMarketFilters();
      $("mkt-hint").textContent = "Live directory pulled from our Google Sheets vendor database at query time — nothing is hardcoded.";
      status.textContent = "Live · " + total + " vendors · last fetched " + (fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "now");
    } catch (e) {
      status.textContent = "Could not load vendors: " + (e.message || e);
      status.classList.add("error");
      $("mkt-table").innerHTML = "";
    }
  }

  function populateMarketFilters(rows) {
    fillSelect("mkt-category", [...new Set(rows.map((r) => r.category))].sort());
    fillSelect("mkt-city", [...new Set(rows.map((r) => r.city))].sort());
  }

  function fillSelect(id, values) {
    const sel = $(id);
    const keep = sel.value;
    sel.innerHTML = '<option value="">' + (id === "mkt-category" ? "All categories" : "All cities") + "</option>";
    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
    sel.value = keep;
  }

  function applyMarketFilters() {
    const q = $("mkt-search").value.trim().toLowerCase();
    const cat = $("mkt-category").value;
    const city = $("mkt-city").value;
    let rows = state.marketRows || [];
    if (q) rows = rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.specialty || "").toLowerCase().includes(q));
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (city) rows = rows.filter((r) => r.city === city);
    renderMarketTable(rows);
  }

  function renderMarketTable(rows) {
    const table = $("mkt-table");
    if (!rows.length) { table.innerHTML = '<tbody><tr><td class="empty">No vendors match those filters.</td></tr></tbody>'; return; }
    let h = '<thead><tr><th>Vendor</th><th>Category</th><th>City</th><th>Price range</th><th>Rating</th><th>Capacity</th><th>Availability</th></tr></thead><tbody>';
    rows.forEach((r) => {
      h += '<tr>' +
        '<td><strong>' + esc(r.name) + '</strong><div class="muted">' + esc(r.specialty || "") + '</div></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + esc(r.city) + '</td>' +
        '<td>' + esc(fmt(r.price_min)) + ' – ' + esc(fmt(r.price_max)) + '</td>' +
        '<td>' + esc(r.rating != null && r.rating !== "" ? r.rating : "—") + ' ★</td>' +
        '<td>' + (r.capacity && Number(r.capacity) > 0 ? esc(r.capacity) + " guests" : "—") + '</td>' +
        '<td>' + esc(r.availability || "—") + '</td>' +
        '</tr>';
    });
    h += '</tbody>';
    table.innerHTML = h;
  }

  /* --------------------------- individual agents ------------------------ */

  function renderAgentsList() {
    const list = $("agents-list");
    list.innerHTML = "";
    AGENT_ORDER.forEach((key) => {
      const a = AGENTS[key];
      const card = document.createElement("article");
      card.className = "agent-profile";
      card.dataset.key = key;
      card.style.setProperty("--accent", a.color);
      card.innerHTML =
        '<header class="agent-head">' +
          '<div class="avatar" style="background:' + a.color + '">' + a.emoji + '</div>' +
          '<div class="agent-id">' +
            '<h3>' + esc(a.name) + ' <span class="archetype">' + esc(a.archetype) + '</span></h3>' +
            '<p class="agent-title">' + esc(a.title) + '</p>' +
          '</div>' +
        '</header>' +
        '<p class="superpower"><span>Superpower</span> ' + esc(a.superpower) + ' · <span>Produces</span> ' + esc(a.produces) + '</p>' +
        '<details class="prompt"><summary>View system prompt</summary><pre>' + esc(a.systemPrompt) + '</pre></details>' +
        '<button class="ghost-btn profile-run" type="button">▶ Run this agent</button>' +
        '<p class="profile-status"></p>' +
        '<div class="profile-output" hidden></div>';
      list.appendChild(card);
      card.querySelector(".profile-run").addEventListener("click", () => runSingleAgent(key));
    });
  }

  function runSingleAgent(key) {
    if (state.running) return;
    const cfg = getConfig();
    if (!cfg) {
      const status = document.querySelector('.agent-profile[data-key="' + key + '"] .profile-status');
      status.textContent = "Direct mode needs an API key + sheet (see Advanced on the Planner tab).";
      return;
    }
    const card = document.querySelector('.agent-profile[data-key="' + key + '"]');
    const outBox = card.querySelector(".profile-output");
    const statusEl = card.querySelector(".profile-status");
    const runBtn = card.querySelector(".profile-run");
    const chain = AGENT_ORDER.slice(0, AGENT_ORDER.indexOf(key) + 1);
    const started = performance.now();

    state.running = true;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    outBox.hidden = false;
    outBox.innerHTML = "";
    statusEl.textContent = "Running: " + chain.map((k) => AGENTS[k].name).join(" → ") + " …";

    const hooks = {
      onAgent: () => {},
      onDone: (k, res) => {
        if (k !== key) return;
        let html = renderToolNote(res.toolLog);
        if (key === "maker") {
          html += res.plan
            ? '<div class="json-ok">✓ ' + esc(AGENTS[key].name) + ' produced a valid plan:</div>' + renderPlan(res.plan)
            : '<pre class="json">' + esc(res.text) + "</pre>";
        } else {
          html += renderMarkdown(res.text);
        }
        outBox.innerHTML = html;
        statusEl.textContent = "Done in " + ((performance.now() - started) / 1000).toFixed(1) + "s";
      },
      onError: (k, e) => {
        if (k !== key) return;
        outBox.innerHTML = '<p class="warn">⚠ ' + esc(String(e.message || e)) + "</p>";
        statusEl.textContent = "Failed";
      },
    };

    runPipeline({ model: cfg.model, apiKey: cfg.apiKey, sheet: cfg.sheet, brief: readBrief(), stopAt: key }, hooks)
      .then(() => { finish(); })
      .catch((e) => { outBox.innerHTML = '<p class="warn">⚠ ' + esc(String(e.message || e)) + "</p>"; statusEl.textContent = "Failed"; finish(); });

    function finish() {
      state.running = false;
      runBtn.disabled = false;
      runBtn.textContent = "▶ Run this agent";
    }
  }

  /* ----------------------------- mode note ------------------------------ */

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

  /* ----------------------------- bind ---------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    initModelSelect();
    initTabs();
    recall();
    setModeNote();
    renderAgentsList();
    $("config-form").addEventListener("submit", onRun);
    $("download-btn").addEventListener("click", downloadJson);
    $("copy-btn").addEventListener("click", copyJson);
    $("api-key").addEventListener("input", remember);
    $("sheet-url").addEventListener("input", remember);
    $("mkt-search").addEventListener("input", applyMarketFilters);
    $("mkt-category").addEventListener("change", applyMarketFilters);
    $("mkt-city").addEventListener("change", applyMarketFilters);
    $("mkt-refresh").addEventListener("click", loadMarketplace);

    // Warm up the backend so the first Run does not hit Render's cold start.
    if (usingBackend()) {
      fetch(CONFIG.API_BASE + "/").catch(() => {});
    }
  });
})();
