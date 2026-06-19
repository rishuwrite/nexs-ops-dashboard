(async () => {
  // CONFIG
  const PICKUP_MONITOR_URL = "https://script.google.com/macros/s/AKfycby2xeJeM81Pk5lky5tscZnXgj0KuP6iN9H6Q7TbZtMXMsJWWFi0k9DPlhF03x2S_T78/exec";
  const FACILITY_CODE = "NXS2";
  const INTERVAL_MS = 3 * 60 * 1000;
  const MONITOR_PAGE_SIZE = 20000;
  const PRINT_CONCURRENCY = 200;
  const CREDENTIALS = { userName: "YOUR_USERNAME_HERE", password: "YOUR_PASSWORD_HERE" };

  const COURIERS = [
    "BLITZNDD", "BLUEDART", "BUSYBEESPPD", "BusybeesSDD",
    "DELCARTB2B", "DELHIVERY", "DELHIVERYPDS", "DOT",
    "DTDCVB2B", "FASTBEETLE", "GPSUPPLY", "PURPLEDRONE",
    "SHADOWFAX", "shreerajxpress", "Velocity", "XPRESSBEES"
  ];

  const PROVIDER_GROUPS = {
    BLITZNDD: ["BLITZNDD"],
    BLUEDART: ["BLUEDART"],
    BUSYBEESPPD: ["BUSYBEESPPD"],
    BusybeesSDD: ["BusybeesSDD"],
    DELCARTB2B: ["DELCARTB2B"],
    DELHIVERY: ["DELHIVERY", "DELHIVERY_DK", "DELHIVERYSFC"],
    DELHIVERYPDS: ["DELHIVERYPDS"],
    DOT: ["DOT", "DOTB2C", "DOTB2CGGN"],
    DTDCVB2B: ["DTDCVB2B"],
    FASTBEETLE: ["FASTBEETLE"],
    GPSUPPLY: ["GPSUPPLY"],
    PURPLEDRONE: ["PURPLEDRONE", "PurpleDrone_Surface", "PURPLEDRONEB2C"],
    SHADOWFAX: ["SHADOWFAX", "SHADOWFAXNCR"],
    shreerajxpress: ["shreerajxpress"],
    Velocity: ["VELOCITYBULK", "VelocityExpress"],
    XPRESSBEES: ["XPRESSBEES"]
  };

  const FR_TAGS = ["FR0", "FR1", "FR2", "BULK", "CL", "OTHERS"];
  const MONITOR_STATUSES = ["Manifest", "Packing"];
  const DETAIL_URL = "https://app.nexs.lenskart.com/nexs/analytics/monitoring/v3/details?version=v3";
  const PRINT_URL = "https://app.nexs.lenskart.com/nexs/wms/api/v1/shipment/print?shippingPackageId=";

  const existing = document.getElementById("nexsCombinedPanel");
  if (existing) existing.remove();
  if (window.__nexsCombinedTimer) clearTimeout(window.__nexsCombinedTimer);

  function nowIST() {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().replace("T", " ").replace("Z", "") + " IST";
  }

  function normalizeProvider(provider) {
    const raw = String(provider || "").trim();
    const upper = raw.toUpperCase();
    for (const courier of COURIERS) {
      if ((PROVIDER_GROUPS[courier] || []).some(alias => alias.toUpperCase() === upper)) return courier;
    }
    return null;
  }

  function zeroCounts() {
    return Object.fromEntries(COURIERS.map(c => [c, 0]));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const panel = document.createElement("div");
  panel.id = "nexsCombinedPanel";
  panel.innerHTML = `
    <div id="ncp-head">
      <strong>LIVE OPS PUSH</strong>
      <div>
        <span id="ncp-next"></span>
        <button id="ncp-run" title="Run now">Run</button>
        <button id="ncp-close" title="Stop">X</button>
      </div>
    </div>
    <div id="ncp-status">Starting...</div>
    <div id="ncp-grid"></div>
    <div id="ncp-foot"></div>
  `;
  document.body.appendChild(panel);

  const style = document.createElement("style");
  style.id = "nexsCombinedPanelStyle";
  style.textContent = `
    #nexsCombinedPanel{position:fixed;right:18px;bottom:18px;width:430px;background:#10141d;color:#e6edf3;font-family:Consolas,monospace;border:1px solid #2d3544;border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.45);z-index:2147483647;overflow:hidden}
    #ncp-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#171d29;border-bottom:1px solid #2d3544;font-size:13px}
    #ncp-head>div{display:flex;gap:6px;align-items:center}
    #ncp-next{color:#8b949e;font-size:11px;min-width:58px;text-align:right}
    #ncp-head button{background:#263044;color:#e6edf3;border:1px solid #3b465c;border-radius:5px;padding:3px 8px;cursor:pointer}
    #ncp-status{padding:9px 12px;color:#58a6ff;font-size:12px;min-height:34px;border-bottom:1px solid #242d3d}
    #ncp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px;max-height:360px;overflow:auto}
    .ncp-card{background:#171d29;border-left:3px solid #3b465c;border-radius:6px;padding:7px 9px;font-size:11px}
    .ncp-name{color:#a9b5c7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
    .ncp-metric{display:flex;justify-content:space-between;gap:8px;line-height:1.35}
    .ncp-hot{color:#ffb86b}.ncp-ok{color:#7ee787}.ncp-warn{color:#ffd866}
    #ncp-foot{padding:7px 12px;border-top:1px solid #242d3d;color:#7d8590;font-size:10px;text-align:right}
  `;
  document.head.appendChild(style);

  const statusEl = document.getElementById("ncp-status");
  const gridEl = document.getElementById("ncp-grid");
  const footEl = document.getElementById("ncp-foot");
  const nextEl = document.getElementById("ncp-next");

  function setStatus(text, color = "#58a6ff") {
    statusEl.textContent = text;
    statusEl.style.color = color;
  }

  function render(manifestCounts, b2cCounts, b2bCounts, storePackingCounts) {
    gridEl.innerHTML = COURIERS.map(c => {
      const total = (manifestCounts[c] || 0) + (b2cCounts[c] || 0) + (b2bCounts[c] || 0) + (storePackingCounts[c] || 0);
      const tone = total > 0 ? "ncp-hot" : "ncp-ok";
      return `
        <div class="ncp-card">
          <div class="ncp-name" title="${c}">${c}</div>
          <div class="ncp-metric"><span>Manifest Done</span><b class="${tone}">${manifestCounts[c] || 0}</b></div>
          <div class="ncp-metric"><span>B2C</span><b>${b2cCounts[c] || 0}</b></div>
          <div class="ncp-metric"><span>B2B</span><b>${b2bCounts[c] || 0}</b></div>
          <div class="ncp-metric"><span>Packing</span><b>${storePackingCounts[c] || 0}</b></div>
        </div>
      `;
    }).join("");
  }

  async function autoLogin() {
    setStatus("Session expired. Auto-login running...", "#ffd866");
    const currentDateTime = new Date().toISOString().replace("T", " ").substring(0, 19);
    const loginResponse = await fetch("https://app.nexs.lenskart.com/v1/user/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "x-lenskart-app-id": "nexs_search"
      },
      body: JSON.stringify(CREDENTIALS)
    });
    const loginData = await loginResponse.json();
    if (!loginResponse.ok || !loginData.success) throw new Error("LOGIN_FAILED");

    const authMeResponse = await fetch("https://app.nexs.lenskart.com/v1/user/authme", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "x-lenskart-app-id": "nexs_search",
        "facility-code": FACILITY_CODE,
        "date-time": currentDateTime,
        "workstation-id": "",
        Authorization: `Bearer ${loginData.content}`
      }
    });
    const authMeData = await authMeResponse.json();
    if (!authMeData.success) throw new Error("AUTHME_FAILED");
    localStorage.setItem("token", authMeData.content);
    sessionStorage.setItem("token", authMeData.content);
  }

  async function checkSession() {
    try {
      const res = await fetch("https://app.nexs.lenskart.com/nexs/manifest/api/v1/fetch/filter?page=0&size=1&sort=createdAt,desc", {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json",
          "facility-code": FACILITY_CODE,
          "source-domain": "https://app.nexs.lenskart.com"
        }
      });
      return res.status !== 401 && res.status !== 403;
    } catch (e) {
      return false;
    }
  }

  async function fetchManifestQuery(query) {
    const res = await fetch(`https://app.nexs.lenskart.com/nexs/manifest/api/v1/fetch/filter?page=0&size=500&sort=createdAt,desc&shippingProvider=${encodeURIComponent(query)}`, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        "facility-code": FACILITY_CODE,
        "source-domain": "https://app.nexs.lenskart.com"
      }
    });
    if (res.status === 401 || res.status === 403) throw new Error("SESSION_EXPIRED");
    if (!res.ok) throw new Error(`MANIFEST_HTTP_${res.status}`);
    const data = await res.json();
    return data?.data?.content || [];
  }

  async function fetchManifestDone() {
    const counts = zeroCounts();
    const seen = new Set();
    for (const courier of COURIERS) {
      setStatus(`Fetching manifest done: ${courier}`);
      const queries = PROVIDER_GROUPS[courier] || [courier];
      for (const query of queries) {
        const rows = await fetchManifestQuery(query);
        rows.forEach(item => {
          const normalized = normalizeProvider(item.shippingProvider);
          if (normalized !== courier) return;
          if (item.status !== "CREATED" || Number(item.count || 0) <= 0) return;
          const key = item.id || item.manifestId || item.manifestCode || item.code || `${item.shippingProvider}|${item.createdAt}|${item.count}`;
          if (seen.has(key)) return;
          seen.add(key);
          counts[courier] += Number(item.count || 0);
        });
        await sleep(80);
      }
    }
    return counts;
  }

  async function fetchMonitor(frTag, status) {
    const res = await fetch(DETAIL_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "facility-code": FACILITY_CODE,
        "source-domain": "https://app.nexs.lenskart.com"
      },
      body: JSON.stringify({
        page: 0,
        pageSize: MONITOR_PAGE_SIZE,
        globalSearch: "",
        category: "FULFILLABLE_ORDERS",
        status,
        frTag,
        version: "v3",
        monitorPanelFilters: {
          binaryFilter: { isMarketPlaceOrder: false, isInternationalOrder: false },
          singleSelectFilters: { errorType: "" },
          monitorPanelRangeFilters: {
            ageingSinceCreated: { startValue: 0, endValue: "-1" },
            ageingSinceLastUpdate: { startValue: 0, endValue: "-1" },
            date: { startValue: "", endValue: "" }
          },
          multiSelectFilters: { pickingPriority: [], qcStatus: [], itemType: [], orderChannel: [] }
        }
      })
    });
    if (res.status === 401 || res.status === 403) throw new Error("SESSION_EXPIRED");
    if (!res.ok) throw new Error(`MONITOR_HTTP_${res.status}`);
    const json = await res.json();
    return (json?.data?.data || []).map(r => ({
      shipmentId: r["Shipping Package ID"],
      status,
      frTag
    })).filter(x => x.shipmentId);
  }

  async function fetchShipment(pkg) {
    const res = await fetch(`${PRINT_URL}${encodeURIComponent(pkg.shipmentId)}&forcePrint=false`, { credentials: "include" });
    if (res.status === 401 || res.status === 403) throw new Error("SESSION_EXPIRED");
    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.data || {};
    return {
      status: pkg.status,
      courier: normalizeProvider(d.shippingProviderCode),
      type: d.storeCode && String(d.storeCode).trim() ? "STS" : "STC"
    };
  }

  async function fetchMonitorCounts() {
    setStatus(`Fetching monitor lists: ${FR_TAGS.length * MONITOR_STATUSES.length} calls`);
    const lists = await Promise.all(FR_TAGS.flatMap(frTag => MONITOR_STATUSES.map(status => fetchMonitor(frTag, status))));
    const byStatusAndShipment = new Map();
    lists.flat().forEach(pkg => byStatusAndShipment.set(`${pkg.status}|${pkg.shipmentId}`, pkg));
    const shipments = [...byStatusAndShipment.values()];

    const b2cCounts = zeroCounts();
    const b2bCounts = zeroCounts();
    const storePackingCounts = zeroCounts();
    let index = 0;
    let done = 0;

    async function worker() {
      while (index < shipments.length) {
        const pkg = shipments[index++];
        const detail = await fetchShipment(pkg);
        done += 1;
        if (done % 100 === 0 || done === shipments.length) {
          setStatus(`Resolving shipments: ${done}/${shipments.length}`);
        }
        if (!detail || !detail.courier) continue;
        if (detail.status === "Manifest") {
          if (detail.type === "STC") b2cCounts[detail.courier] += 1;
          if (detail.type === "STS") b2bCounts[detail.courier] += 1;
        }
        if (detail.status === "Packing") storePackingCounts[detail.courier] += 1;
      }
    }

    await Promise.all(Array.from({ length: Math.min(PRINT_CONCURRENCY, shipments.length || 1) }, worker));
    return { b2cCounts, b2bCounts, storePackingCounts, shipmentCount: shipments.length };
  }

  async function pushCombined(payload) {
    await fetch(PICKUP_MONITOR_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
  }

  let isRunning = false;
  let stopped = false;
  let nextTick = 0;
  let countdownTimer = null;

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    nextTick = Date.now() + INTERVAL_MS;
    countdownTimer = setInterval(() => {
      const left = Math.max(0, nextTick - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      nextEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (left <= 0) clearInterval(countdownTimer);
    }, 1000);
  }

  function scheduleNext() {
    if (stopped) return;
    startCountdown();
    window.__nexsCombinedTimer = setTimeout(runCycle, INTERVAL_MS);
  }

  async function runCycle(retried = false) {
    if (isRunning || stopped) return;
    isRunning = true;
    let retrying = false;
    if (window.__nexsCombinedTimer) clearTimeout(window.__nexsCombinedTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    nextEl.textContent = "running";

    try {
      setStatus("Checking session...");
      if (!(await checkSession())) await autoLogin();

      const startedAt = Date.now();
      const timestamp = nowIST();
      const runId = "LIVE-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      const counts = await fetchManifestDone();
      const monitor = await fetchMonitorCounts();

      setStatus("Pushing combined snapshot to sheet...");
      await pushCombined({
        type: "combinedSnapshot",
        timestamp,
        monitorTimestamp: nowIST(),
        runId,
        facilityCode: FACILITY_CODE,
        counts,
        b2cCounts: monitor.b2cCounts,
        b2bCounts: monitor.b2bCounts,
        storePackingCounts: monitor.storePackingCounts
      });

      render(counts, monitor.b2cCounts, monitor.b2bCounts, monitor.storePackingCounts);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const total = COURIERS.reduce((sum, c) => sum + counts[c] + monitor.b2cCounts[c] + monitor.b2bCounts[c] + monitor.storePackingCounts[c], 0);
      setStatus(`Pushed ${runId} in ${seconds}s`, "#7ee787");
      footEl.textContent = `${monitor.shipmentCount} shipments checked · dashboard total ${total} · ${nowIST()}`;
    } catch (err) {
      if (err.message === "SESSION_EXPIRED" && !retried) {
        try {
          await autoLogin();
          isRunning = false;
          retrying = true;
          return runCycle(true);
        } catch (loginErr) {
          setStatus("Auto-login failed. Log in manually, then press Run.", "#ff7b72");
        }
      } else {
        setStatus(`Error: ${err.message}`, "#ff7b72");
      }
    } finally {
      isRunning = false;
      if (!retrying) scheduleNext();
    }
  }

  document.getElementById("ncp-close").onclick = () => {
    stopped = true;
    if (window.__nexsCombinedTimer) clearTimeout(window.__nexsCombinedTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    panel.remove();
    document.getElementById("nexsCombinedPanelStyle")?.remove();
    delete window.__nexsCombinedTimer;
  };

  document.getElementById("ncp-run").onclick = () => runCycle();

  await runCycle();
})();
