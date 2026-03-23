function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderWaveControlUi(config) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(config.ui.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans+Condensed:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #08101b;
      --panel: #0f1b2d;
      --panel-2: #17263b;
      --text: #eef3fb;
      --muted: #9fb1c7;
      --line: #26415d;
      --accent: #53e0b0;
      --accent-2: #7bb5ff;
      --warn: #ffc56a;
      --danger: #ff7b86;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans Condensed", sans-serif;
      letter-spacing: 0.01em;
      color: var(--text);
      background:
        linear-gradient(140deg, rgba(83, 224, 176, 0.08), transparent 28%),
        radial-gradient(circle at top right, rgba(83, 224, 176, 0.12), transparent 30%),
        radial-gradient(circle at top left, rgba(123, 181, 255, 0.12), transparent 25%),
        repeating-linear-gradient(
          90deg,
          rgba(159, 177, 199, 0.02) 0,
          rgba(159, 177, 199, 0.02) 1px,
          transparent 1px,
          transparent 72px
        ),
        var(--bg);
    }
    header {
      padding: 26px 28px 14px;
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      background: rgba(9, 17, 31, 0.92);
      backdrop-filter: blur(10px);
      z-index: 10;
    }
    header::after {
      content: "";
      display: block;
      width: 220px;
      height: 2px;
      margin-top: 16px;
      background: linear-gradient(90deg, var(--accent), transparent);
    }
    h1, h2, h3 { margin: 0; }
    h1 {
      font-family: "Instrument Serif", serif;
      font-size: clamp(34px, 4vw, 48px);
      font-weight: 400;
      letter-spacing: 0.01em;
    }
    .subhead {
      margin-top: 10px;
      color: var(--muted);
      font-size: 14px;
      max-width: 720px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
      align-items: center;
    }
    .toolbar input, .toolbar button, .toolbar select {
      background: var(--panel);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      font: inherit;
    }
    .toolbar button {
      cursor: pointer;
      background: linear-gradient(135deg, rgba(83, 224, 176, 0.18), rgba(123, 181, 255, 0.18));
    }
    main {
      padding: 24px 28px 40px;
      display: grid;
      gap: 20px;
      grid-template-columns: minmax(240px, 320px) minmax(320px, 1fr) minmax(320px, 1fr);
    }
    .panel {
      background: linear-gradient(180deg, rgba(23, 37, 60, 0.95), rgba(17, 28, 48, 0.95));
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      overflow: hidden;
      min-height: 220px;
      position: relative;
    }
    .panel::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(123, 181, 255, 0.03), transparent 38%);
      pointer-events: none;
    }
    .panel h2, .panel h3 {
      padding: 16px 18px 0;
      font-family: "Instrument Serif", serif;
      font-weight: 400;
      letter-spacing: 0.02em;
    }
    .panel-body {
      padding: 16px 18px 18px;
      position: relative;
      z-index: 1;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
    }
    .metric {
      padding: 14px;
      background: rgba(9, 17, 31, 0.45);
      border: 1px solid rgba(159, 176, 201, 0.15);
      border-radius: 14px;
    }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric .value {
      font-size: 24px;
      margin-top: 6px;
      font-weight: 700;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    .card {
      border: 1px solid rgba(159, 176, 201, 0.18);
      background: rgba(9, 17, 31, 0.42);
      border-radius: 14px;
      padding: 12px;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
    }
    .card:hover {
      border-color: rgba(83, 224, 176, 0.55);
      transform: translateY(-2px);
      background: rgba(9, 17, 31, 0.6);
    }
    .card .meta, .muted {
      color: var(--muted);
      font-size: 13px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 12px;
      background: rgba(123, 181, 255, 0.12);
      color: var(--accent-2);
      margin-right: 6px;
      margin-top: 6px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: rgba(9, 17, 31, 0.65);
      border: 1px solid rgba(159, 176, 201, 0.12);
      border-radius: 14px;
      padding: 14px;
      color: #d9e6fb;
      font-size: 12px;
      max-height: 420px;
      overflow: auto;
    }
    .split {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
    .section-title {
      margin: 0 0 10px;
      font-size: 14px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .inline-actions button, .inline-actions select {
      background: rgba(9, 17, 31, 0.55);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      font: inherit;
    }
    a { color: var(--accent); }
    .empty { color: var(--muted); font-style: italic; }
    @media (max-width: 1100px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(config.ui.title)}</h1>
    <div class="subhead">Local-first run telemetry, proof analytics, and benchmark validity review.</div>
    <div class="toolbar">
      <input id="authToken" type="password" placeholder="Bearer token for read APIs" />
      <input id="workspaceFilter" placeholder="Workspace id filter" />
      <button id="refreshButton">Refresh</button>
      <span id="statusText" class="muted"></span>
    </div>
  </header>
  <main>
    <section class="panel">
      <h2>Overview</h2>
      <div class="panel-body">
        <div id="overviewMetrics" class="metrics"></div>
        <div style="margin-top:16px">
          <div class="section-title">Run Explorer</div>
          <div id="runList" class="list"></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Run Detail</h2>
      <div class="panel-body">
        <div id="runDetail" class="empty">Select a run to inspect timeline, gates, proof bundles, and artifacts.</div>
      </div>
    </section>
    <section class="panel">
      <h2>Benchmark Explorer</h2>
      <div class="panel-body">
        <div id="benchmarkList" class="list"></div>
        <div style="margin-top:16px">
          <div id="benchmarkDetail" class="empty">Select a benchmark run to inspect review validity, verifier outputs, and arm comparisons.</div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const state = {
      selectedRun: null,
      selectedBenchmark: null,
      runDetail: null,
      benchmarkDetail: null,
    };

    function authHeaders() {
      const token = document.getElementById("authToken").value.trim();
      return token ? { Authorization: "Bearer " + token } : {};
    }

    async function api(path) {
      const response = await fetch(path, { headers: authHeaders() });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }
      return response.json();
    }

    function fmt(value) {
      if (value === null || value === undefined || value === "") return "n/a";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function renderMetrics(overview) {
      const metrics = [
        ["Runs", overview.runCount],
        ["Benchmarks", overview.benchmarkRunCount],
        ["Coordination Records", overview.coordinationRecordCount],
        ["Proof Bundles", overview.proofBundleCount],
      ];
      document.getElementById("overviewMetrics").innerHTML = metrics.map(([label, value]) => \`
        <div class="metric">
          <div class="label">\${label}</div>
          <div class="value">\${fmt(value)}</div>
        </div>
      \`).join("");
    }

    function renderRunList(runs) {
      const root = document.getElementById("runList");
      if (!runs.length) {
        root.innerHTML = '<div class="empty">No runs available.</div>';
        return;
      }
      root.innerHTML = runs.map((run) => \`
        <div class="card" data-run="\${encodeURIComponent(JSON.stringify({ runId: run.runId, lane: run.lane, wave: run.wave, runKind: run.runKind, workspaceId: run.workspaceId }))}">
          <strong>\${fmt(run.runId || ("wave-" + run.wave))}</strong>
          <div class="meta">\${fmt(run.runKind)} · \${fmt(run.lane)} · wave \${fmt(run.wave)}</div>
          <div class="meta">status=\${fmt(run.status)} · attempts=\${fmt(run.attemptCount)} · gate=\${fmt(run.latestGate)}</div>
        </div>
      \`).join("");
      root.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("click", async () => {
          state.selectedRun = JSON.parse(decodeURIComponent(card.dataset.run));
          await loadRunDetail();
        });
      });
    }

    function renderRunDetail(detail) {
      const root = document.getElementById("runDetail");
      if (!detail) {
        root.innerHTML = '<div class="empty">Run detail unavailable.</div>';
        return;
      }
      const attempts = detail.attempts || [];
      const artifacts = detail.artifacts || [];
      const proofs = detail.proofs || [];
      const timeline = detail.timeline || [];
      root.innerHTML = \`
        <div class="split">
          <div>
            <div class="section-title">Summary</div>
            <div class="metrics">
              <div class="metric"><div class="label">Status</div><div class="value">\${fmt(detail.summary.status)}</div></div>
              <div class="metric"><div class="label">Attempts</div><div class="value">\${fmt(detail.summary.attemptCount)}</div></div>
              <div class="metric"><div class="label">Gate</div><div class="value">\${fmt(detail.summary.latestGate)}</div></div>
            </div>
            <div style="margin-top:16px">
              <div class="section-title">Proof Bundles</div>
              \${proofs.length ? proofs.map((proof) => \`<div class="pill">\${fmt(proof.entityId)} · \${fmt(proof.action)}</div>\`).join("") : '<div class="empty">No proof bundles.</div>'}
            </div>
          </div>
          <div>
            <div class="section-title">Attempt Comparison</div>
            <div class="inline-actions">
              <select id="attemptLeft">\${attempts.map((attempt) => \`<option value="\${attempt.entityId}">\${attempt.entityId}</option>\`).join("")}</select>
              <select id="attemptRight">\${attempts.map((attempt) => \`<option value="\${attempt.entityId}">\${attempt.entityId}</option>\`).join("")}</select>
            </div>
            <pre id="attemptCompare">\${escapeHtml(JSON.stringify(attempts, null, 2))}</pre>
          </div>
        </div>
        <div style="margin-top:16px">
          <div class="section-title">Artifacts</div>
          \${artifacts.length ? artifacts.map((artifact) => \`
            <div class="card">
              <strong>\${fmt(artifact.kind)}</strong>
              <div class="meta">\${fmt(artifact.path)}</div>
              <div class="meta">event=\${fmt(artifact.eventId)} · bytes=\${fmt(artifact.bytes)} · upload=\${fmt(artifact.uploadPolicy)}</div>
              <div class="meta"><a href="/api/v1/artifact?eventId=\${encodeURIComponent(artifact.eventId)}&artifactId=\${encodeURIComponent(artifact.artifactId)}" target="_blank">Artifact API</a></div>
            </div>
          \`).join("") : '<div class="empty">No artifacts.</div>'}
        </div>
        <div style="margin-top:16px">
          <div class="section-title">Timeline</div>
          <pre>\${escapeHtml(JSON.stringify(timeline, null, 2))}</pre>
        </div>
      \`;
      const compare = () => {
        const left = attempts.find((attempt) => attempt.entityId === document.getElementById("attemptLeft").value) || null;
        const right = attempts.find((attempt) => attempt.entityId === document.getElementById("attemptRight").value) || null;
        document.getElementById("attemptCompare").textContent = JSON.stringify({ left, right }, null, 2);
      };
      const leftSelect = document.getElementById("attemptLeft");
      const rightSelect = document.getElementById("attemptRight");
      if (leftSelect && rightSelect) {
        leftSelect.addEventListener("change", compare);
        rightSelect.addEventListener("change", compare);
        compare();
      }
    }

    function renderBenchmarkList(benchmarks) {
      const root = document.getElementById("benchmarkList");
      if (!benchmarks.length) {
        root.innerHTML = '<div class="empty">No benchmark runs available.</div>';
        return;
      }
      root.innerHTML = benchmarks.map((run) => \`
        <div class="card" data-benchmark="\${encodeURIComponent(JSON.stringify({ benchmarkRunId: run.benchmarkRunId, workspaceId: run.workspaceId }))}">
          <strong>\${fmt(run.benchmarkRunId)}</strong>
          <div class="meta">\${fmt(run.adapter && run.adapter.id)} · \${fmt(run.manifest && run.manifest.id)}</div>
          <div class="meta">items=\${fmt(run.benchmarkItemCount)} · comparison=\${fmt(run.comparisonMode)} · publishable=\${fmt(run.comparisonReady)}</div>
        </div>
      \`).join("");
      root.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("click", async () => {
          state.selectedBenchmark = JSON.parse(decodeURIComponent(card.dataset.benchmark));
          await loadBenchmarkDetail();
        });
      });
    }

    function renderBenchmarkDetail(detail) {
      const root = document.getElementById("benchmarkDetail");
      if (!detail) {
        root.innerHTML = '<div class="empty">Benchmark detail unavailable.</div>';
        return;
      }
      const items = detail.items || [];
      const reviews = detail.reviews || [];
      const groupByTask = {};
      items.forEach((item) => {
        const taskId = item.data && item.data.taskId ? item.data.taskId : item.entityId;
        groupByTask[taskId] = groupByTask[taskId] || [];
        groupByTask[taskId].push(item);
      });
      root.innerHTML = \`
        <div class="split">
          <div>
            <div class="section-title">Run Summary</div>
            <pre>\${escapeHtml(JSON.stringify(detail.summary, null, 2))}</pre>
          </div>
          <div>
            <div class="section-title">Review Validity</div>
            <pre>\${escapeHtml(JSON.stringify(reviews.map((review) => review.data), null, 2))}</pre>
          </div>
        </div>
        <div style="margin-top:16px">
          <div class="section-title">Arm Comparison</div>
          <pre>\${escapeHtml(JSON.stringify(groupByTask, null, 2))}</pre>
        </div>
      \`;
    }

    async function loadRunDetail() {
      if (!state.selectedRun) return;
      const params = new URLSearchParams(state.selectedRun);
      state.runDetail = await api("/api/v1/run?" + params.toString());
      renderRunDetail(state.runDetail);
    }

    async function loadBenchmarkDetail() {
      if (!state.selectedBenchmark) return;
      const params = new URLSearchParams(state.selectedBenchmark);
      state.benchmarkDetail = await api("/api/v1/benchmark?" + params.toString());
      renderBenchmarkDetail(state.benchmarkDetail);
    }

    async function refresh() {
      const workspaceId = document.getElementById("workspaceFilter").value.trim();
      const query = workspaceId ? ("?workspaceId=" + encodeURIComponent(workspaceId)) : "";
      try {
        document.getElementById("statusText").textContent = "Refreshing...";
        const [overview, runs, benchmarks] = await Promise.all([
          api("/api/v1/analytics/overview" + query),
          api("/api/v1/runs" + query),
          api("/api/v1/benchmarks" + query),
        ]);
        renderMetrics(overview);
        renderRunList(runs);
        renderBenchmarkList(benchmarks);
        document.getElementById("statusText").textContent = "Updated " + new Date().toLocaleTimeString();
        if (state.selectedRun) {
          await loadRunDetail();
        }
        if (state.selectedBenchmark) {
          await loadBenchmarkDetail();
        }
      } catch (error) {
        document.getElementById("statusText").textContent = String(error.message || error);
      }
    }

    document.getElementById("refreshButton").addEventListener("click", refresh);
    refresh();
  </script>
</body>
</html>`;
}
