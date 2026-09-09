/* 广平经济开发区服务平台 · H5 */
(function () {
"use strict";

/* ================= 账号 ================= */
const ACCOUNTS = {
  "开发区": { pwd: "123123", role: "dev",   display: "开发区" },
  "后台":   { pwd: "123123", role: "admin", display: "后台"   }
};
const LS_SESSION = "gp_edz_session_v1";
const LS_STATE   = "gp_edz_state_v1";

let session = null;
let state = null;
let AUTH_TOKEN = null;    // 服务端登录后发放的会话令牌，写接口需携带
let INVEST = { projects: [], news: [] };   // 招商引资（与招商业务系统同步，H5 内只读展示）
const GUEST = !!(typeof window !== "undefined" && window.GUEST_MODE);  // 镜像站：免登录、只读

/* ================= 工具 ================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const N = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
function fmt(v, d) {
  if (v === null || v === undefined || v === "" || v === "None") return "—";
  const n = Number(v); if (!isFinite(n)) return "—";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 0 : d });
}
const num = (v, d) => (v === null || v === undefined || v === "" ) ? "—" : (fmt(v, d === undefined ? 2 : d));
const txt = (v) => (v === null || v === undefined || String(v).trim() === "" || v === "None") ? "—" : esc(v);
const wan = (v) => Math.abs(N(v)) >= 10000 ? { v: (N(v) / 10000).toFixed(2), u: "亿元" } : { v: fmt(v, 0), u: "万元" };
const fmtWan = (v) => Math.abs(N(v)) >= 10000 ? (N(v) / 10000).toFixed(2) + "亿" : fmt(v, 0);
const initials = (n) => String(n || "").replace(/^河北|^广平县?/, "").replace(/(股份有限公司|有限责任公司|有限公司|公司)$/, "").slice(0, 2);
function hueOf(s) { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const CN_NUM = ["一","二","三","四","五","六","七","八","九","十"];
const pianquLabel = (n) => (n ? "第" + (CN_NUM[N(n) - 1] || n) + "片区" : "—");
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

/* 招商引资数据：优先用服务端同步回来的，没有则回落到随包发布的静态数据 */
function setInvest(src) {
  const F = window.INVEST_DATA || {};
  INVEST = {
    projects: (src && src.investProjects && src.investProjects.length) ? src.investProjects : (F.investProjects || []),
    news: (src && src.investNews && src.investNews.length) ? src.investNews : (F.investNews || [])
  };
  applyInvestOpinions();
}
/* 本项目内填写的县领导意见覆盖招商系统同步来的原始值 */
function applyInvestOpinions() {
  const ov = (state && state.investOpinions) || {};
  const ks = Object.keys(ov);
  if (!ks.length) return;
  INVEST.projects = (INVEST.projects || []).map((p) =>
    ov[p.id] !== undefined ? Object.assign({}, p, { leader_opinion: ov[p.id] }) : p);
}

const isAdmin = () => !!session && session.role === "admin";
const canEditLeader = () => !!session && session.role !== "guest";   // 开发区 / 后台 可填；访客只读
const byId = () => { const m = {}; (state.enterprises || []).forEach((e) => m[e.id] = e); return m; };

/* ================= 数据存取（本地兜底 + 服务端同步） ================= */
let CLOUD = false;          // 是否连上同步服务（连上则多设备共享同一份数据）
let SYNC = "local";         // local | syncing | ok | err

function snapshot() {
  return { title: state.title, park: state.park, enterprises: state.enterprises,
           weeklyNews: state.weeklyNews, leaderOpinion: state.leaderOpinion,
           dismissedWeekly: state.dismissedWeekly || [],
           autoOverrides: state.autoOverrides || {},
           investOpinions: state.investOpinions || {} };
}
function loadState() {
  const base = JSON.parse(JSON.stringify(window.BASE_DATA));
  try {
    const ov = JSON.parse(localStorage.getItem(LS_STATE) || "null");
    if (ov && ov.enterprises) {
      base.park = Object.assign(base.park, ov.park || {});
      base.enterprises = ov.enterprises;
      base.weeklyNews = ov.weeklyNews || base.weeklyNews;
      base.leaderOpinion = ov.leaderOpinion || base.leaderOpinion;
      base.autoOverrides = ov.autoOverrides || {};
      base.investOpinions = ov.investOpinions || {};
    }
  } catch (e) {}
  return base;
}
function saveState() {
  const snap = snapshot();
  try { localStorage.setItem(LS_STATE, JSON.stringify(snap)); } catch (e) {}
  if (!CLOUD) { setSync("local"); return; }
  setSync("syncing");
  const hdrs = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) hdrs["Authorization"] = "Bearer " + AUTH_TOKEN;
  if (AUTH_TOKEN) hdrs["X-Auth-Token"] = AUTH_TOKEN;
  fetch("/api/state", {
    method: "PUT", headers: hdrs, body: JSON.stringify(snap)
  }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(() => setSync("ok"))
    .catch((err) => {
      if (String(err.message).includes("401")) { window.onTokenExpired(); return; }
      setSync("err");
    });
}
function setSync(s) {
  SYNC = s;
  const d = $("#syncDot"); if (!d) return;
  d.className = "sync-dot " + (s === "local" ? "" : s);
  d.title = s === "ok" ? "已同步到服务器，其他设备登录可见"
    : s === "err" ? "同步失败，改动仅保存在本机"
    : s === "syncing" ? "正在同步…"
    : "未连接同步服务，改动仅保存在本机";
}

/* ================= 指标汇总 ================= */
function isWarnFirm(f) {
  if ((f.op_status || "") === "半停产") return false;
  const a = N(f.revenue_h1_2025), b = N(f.revenue_2026);
  return a > 0 && (b - a) / a < -0.10;
}
function summary() {
  const E = state.enterprises || [];
  const sum = (k) => E.reduce((a, f) => a + N(f[k]), 0);
  return {
    count: E.length,
    total_revenue: sum("revenue_2025"),
    total_tax: sum("tax_2025"),
    total_energy: sum("energy_2025"),
    total_output: sum("output_2025"),
    total_employees: sum("employee_count"),
    above_scale_count: E.filter((f) => f.is_above_scale == 1 || f.is_above_scale === true).length,
    warning_count: E.filter(isWarnFirm).length
  };
}

/* ================= 登录 ================= */
window.onLoginSubmit = async function () {
  const u = ($("#lgUser").value || "").trim();
  const p = $("#lgPwd").value || "";
  const acc = ACCOUNTS[u];
  if (!acc || acc.pwd !== p) { $("#lgErr").textContent = "账号或密码错误"; return; }
  $("#lgErr").textContent = "";
  // 连上同步服务时，必须由服务端校验并下发会话令牌，写操作才被接受
  if (CLOUD) {
    try {
      const r = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      if (!r.ok) { $("#lgErr").textContent = "账号或密码错误"; return; }
      const j = await r.json();
      AUTH_TOKEN = j.token;
      session = { username: u, role: j.role, display: j.display, token: j.token };
    } catch (e) {
      // 服务端不可达：退回仅本机模式（写操作无法同步）
      CLOUD = false;
      session = { username: u, role: acc.role, display: acc.display };
    }
  } else {
    session = { username: u, role: acc.role, display: acc.display };
  }
  localStorage.setItem(LS_SESSION, JSON.stringify(session));
  if (!CLOUD) state = loadState();   // 连上同步服务时直接用服务端数据，避免本机旧数据覆盖其他设备的修改
  enterApp();
};
window.doLogout = function () {
  session = null; localStorage.removeItem(LS_SESSION);
  closeMgr(); closeDetail(); closeSheet(); closeModal();
  $("#login").classList.add("on");
  $("#lgUser").value = ""; $("#lgPwd").value = "";
};
window.onTokenExpired = function () {
  AUTH_TOKEN = null; session = null;
  localStorage.removeItem(LS_SESSION);
  setSync("err");
  alert("登录已失效，请重新登录后再保存。");
  doLogout();
};
function enterApp() {
  $("#login").classList.remove("on");
  $("#hdrTitle").textContent = state.title || "广平经济开发区服务平台";
  document.title = state.title || "广平经济开发区服务平台";
  renderHeader();
  setSync(CLOUD ? "ok" : "local");      // 须在 renderHeader 之后，状态点才存在
  renderHome(); renderAnalysis(); renderWeekly(); renderInvest(); renderNotices();
  switchTab("home");
}

/* ================= 头部 ================= */
function renderHeader() {
  let html = `<span class="sync-dot" id="syncDot"></span>
    <span class="role-tag ${isAdmin() ? "admin" : ""}">${esc(session.display)}</span>`;
  if (isAdmin()) html += `<span class="hdr-btn" onclick="openMgr('overview')">⚙ 管理</span>`;
  html += `<span class="hdr-btn" onclick="doLogout()">退出</span>`;
  $("#hdrActions").innerHTML = html;
  $("#ovEditLink").innerHTML = isAdmin() ? `<span class="el" onclick="openMgr('overview')">✎ 编辑概况</span>` : "";
  $("#weeklyEditLink").innerHTML = isAdmin() ? `<span class="el" onclick="openMgr('weekly')">✎ 管理</span>` : "";
  $("#leaderEditLink").innerHTML = canEditLeader() ? `<span class="el" onclick="editLeader()">✎ 编辑</span>` : "";
}
window.switchTab = function (tab) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  $("#page-" + tab).classList.add("active");
  $("#content").scrollTop = 0;
  if (tab === "invest") renderInvest();
};

/* ================= 首页 · 园区概况 ================= */
let heroTimer = null;
function renderHome() {
  const P = state.park;
  $("#parkDesc").textContent = P.desc || "";
  const banners = (P.banners && P.banners.length) ? P.banners : [];
  $("#hero").innerHTML = banners.map((src, i) =>
    `<div class="slide${i === 0 ? " active" : ""}" style="background-image:url('${esc(src)}')"><div class="hero-cap">${esc(P.name || "")}</div></div>`
  ).join("");
  $("#heroDots").innerHTML = banners.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("");
  if (heroTimer) clearInterval(heroTimer);
  let idx = 0;
  heroTimer = setInterval(() => {
    const s = document.querySelectorAll("#hero .slide"), d = document.querySelectorAll("#heroDots i");
    if (s.length < 2) return;
    s[idx].classList.remove("active"); d[idx].classList.remove("on");
    idx = (idx + 1) % s.length;
    s[idx].classList.add("active"); d[idx].classList.add("on");
  }, 3500);
  $("#highlights").innerHTML = (P.highlights || []).map((h) =>
    `<div class="hl"><div class="ico">${h.ico || "🏭"}</div><div class="t">${esc(h.t)}</div><div class="d">${esc(h.d)}</div></div>`
  ).join("");
  renderEntList(state.enterprises);
}
function renderEntList(list) {
  const box = $("#entList"); list = list || [];
  if (!list.length) { box.innerHTML = `<div class="empty">未找到匹配企业</div>`; return; }
  box.innerHTML = list.map((e) => {
    const scale = e.is_above_scale == 1 ? `<span class="tag green">规上</span>` : "";
    const st = (e.op_status && e.op_status !== "正常生产") ? `<span class="tag orange">${esc(e.op_status)}</span>` : "";
    const edit = isAdmin() ? `<span class="ent-edit" onclick="event.stopPropagation();editEnterprise(${e.id})">✎</span>` : "";
    return `<div class="ent" onclick="openDetail(${e.id})">
      <div class="logo" style="background:hsl(${hueOf(e.name)},52%,48%)">${esc(initials(e.name))}</div>
      <div class="info"><div class="nm">${esc(e.name)}</div>
        <div class="meta"><span class="tag">${esc(e.industry || "—")}</span>${scale}<span>${esc(e.location || "")}</span>${st}</div></div>
      <div class="arrow">›</div>${edit}</div>`;
  }).join("");
}
window.onSearch = function (v) {
  v = (v || "").trim();
  if (!v) return renderEntList(state.enterprises);
  const f = (state.enterprises || []).filter((e) =>
    (String(e.name) + String(e.industry) + String(e.main_product) + String(e.location)).toLowerCase().includes(v.toLowerCase()));
  renderEntList(f);
};

/* ================= 企业详情（全屏） ================= */
window.openDetail = function (id) {
  const e = byId()[id]; if (!e) return;
  $("#detailTitle").textContent = e.name;
  const hue = hueOf(e.name);
  const scale = e.is_above_scale == 1 ? `<span class="tag green">规上企业</span>` : `<span class="tag">非规上</span>`;
  $("#detailActions").innerHTML = isAdmin()
    ? `<span class="hdr-btn" onclick="editEnterprise(${e.id})">✎ 编辑</span><span class="hdr-btn" onclick="delEnterprise(${e.id})">🗑 删除</span>` : "";
  const vals = [
    ["营收", fmt(e.revenue_2025, 0), "万元", "2025"],
    ["税收", fmt(e.tax_2025, 0), "万元", "2025"],
    ["用电", fmt(e.energy_2025, 0), "万kWh", "2025"]
  ];
  const composite = [e.intro, e.brand, e.other_honors, e.main_product ? "主营产品：" + e.main_product : "", e.production_capacity ? "年生产能力：" + e.production_capacity : ""].filter(Boolean).join("\n\n");
  const intro = e.intro_edited ? (e.intro || "") : composite;
  const photos = (Array.isArray(e.photos) && e.photos.length) ? e.photos : [];
  const gallery = photos.length
    ? photos.map((src, i) => `<div class="ph"><img src="${esc(src)}"><div class="cap">企业实景 ${i + 1}</div></div>`).join("")
    : `<div class="empty" style="padding:14px 0">暂无企业实景图片，后台编辑企业时可上传</div>`;
  $("#detailBody").innerHTML = `
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center">
        <div class="logo" style="width:46px;height:46px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;background:hsl(${hue},52%,48%);font-size:16px">${esc(initials(e.name))}</div>
        <div><div style="font-weight:700;font-size:16px">${esc(e.name)}</div>
        <div style="margin-top:4px">${scale}</div></div>
      </div>
      <div class="mini-metrics">${vals.map((v) => `<div class="mini"><div class="n">${v[1]}<span class="u">${v[2]}</span></div><div class="l">${v[0]}</div><div class="y">${v[3]}</div></div>`).join("")}</div>
    </div>
    <div class="card">
      <div class="section-title" style="margin:0 0 4px"><span class="bar"></span>企业介绍</div>
      <div class="desc" style="white-space:pre-wrap">${esc(intro) || "—"}</div>
    </div>
    <div class="card">
      <div class="section-title" style="margin:0 0 4px"><span class="bar"></span>企业实景</div>
      <div class="gallery">${gallery}</div>
    </div>`;
  $("#detail").classList.add("on");
};
window.closeDetail = function () { $("#detail").classList.remove("on"); };
function kv(k, v) { return `<div class="kv"><span class="k">${k}</span><span class="v">${esc(v) === "" ? "—" : esc(v)}</span></div>`; }

/* ================= 企业分析 · 核心指标 ================= */
const KPI_LIST_CFG = {
  total:   { title: "企业名单",       main: "revenue_2025", warn: true,  tip: "开发区在册企业，按营业收入（2025 年）由高到低排列，点击企业查看「比较分析 / 预警分析」。" },
  revenue: { title: "企业营收名单",   main: "revenue_2025", warn: false, tip: "营业收入（2025 年）由高到低排列，点击企业查看比较分析。" },
  tax:     { title: "企业税收名单",   main: "tax_2025",     warn: false, tip: "税收（2025 年）由高到低排列，点击企业查看比较分析。" },
  energy:  { title: "企业用电量名单", main: "energy_2025",  warn: false, tip: "工业用电量（2025 年）由高到低排列，点击企业查看比较分析。" },
  scale:   { title: "规上企业名单",   main: "revenue_2025", warn: false, tip: "规模以上企业名单，按营业收入（2025 年）由高到低排列，点击企业查看比较分析。" }
};
function renderAnalysis() {
  const s = summary();
  const rw = wan(s.total_revenue), tw = wan(s.total_tax);
  const card = (label, value, unit, foot, cls, onclick) =>
    `<div class="kpi-card ${cls || ""} clickable" onclick="${onclick}">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}<span class="kpi-unit"> ${unit}</span></div>
      <div class="kpi-foot">${foot}</div></div>`;
  $("#kpiGrid").innerHTML =
      card("企业总数", fmt(s.count, 0), "家", "点击查看企业名单 ›", "", "showKpiList('total')")
    + card("总营收", rw.v, rw.u, "点击查看企业名单 ›", "", "showKpiList('revenue')")
    + card("总税收", tw.v, tw.u, "点击查看企业名单 ›", "", "showKpiList('tax')")
    + card("工业用电量", fmtWan(s.total_energy), "万kwh", "点击查看企业名单 ›", "", "showKpiList('energy')")
    + card("规上企业", fmt(s.above_scale_count, 0), "家", "点击查看企业名单 ›", "", "showKpiList('scale')")
    + card("预警企业", fmt(s.warning_count, 0), "家", "营收同比下滑超 10% ›", "kpi-warn", "showWarnList()");
  renderLeader();
}

/* --- 名单弹窗内的搜索框 --- */
function sheetSearchBar(ph) {
  return `<div class="search" style="margin:0 0 12px"><input id="sheetSearch" placeholder="${ph}" oninput="filterSheetList(this.value)" autocomplete="off"></div>`;
}
window.filterSheetList = function (kw) {
  kw = (kw || "").trim().toLowerCase();
  document.querySelectorAll("#sheetBody .filter-item").forEach((el) => {
    const t = (el.getAttribute("data-kw") || "").toLowerCase();
    el.style.display = (!kw || t.indexOf(kw) >= 0) ? "" : "none";
  });
};
/* --- 点击数字 → 企业名单 --- */
window.showKpiList = function (kind) {
  const cfg = KPI_LIST_CFG[kind] || KPI_LIST_CFG.total;
  let list = (state.enterprises || []).slice();
  if (kind === "scale") list = list.filter((f) => f.is_above_scale == 1 || f.is_above_scale === true);
  list.sort((a, b) => N(b[cfg.main]) - N(a[cfg.main]));
  const S = (k) => list.reduce((a, f) => a + N(f[k]), 0);
  const hi = (k, v) => k === cfg.main
    ? `<b style="color:var(--primary)">${fmt(v, 0)}</b>`
    : `<span class="muted">${fmt(v, 0)}</span>`;
  const rows = list.map((f, i) => `
    <tr class="filter-item" data-kw="${esc(f.name)}" onclick="openEntModal(${f.id},'kpi:${kind}',${!cfg.warn})">
      <td>${i + 1}</td>
      <td><b style="color:var(--primary)">${esc(f.name)}</b></td>
      <td>${f.is_above_scale == 1 ? '<span class="tag green">规上</span>' : '<span class="tag">非规上</span>'}</td>
      <td class="num">${hi("revenue_2025", f.revenue_2025)}</td>
      <td class="num">${hi("tax_2025", f.tax_2025)}</td>
      <td class="num">${hi("energy_2025", f.energy_2025)}</td>
    </tr>`).join("");
  openSheet(`🏭 ${cfg.title}（${list.length} 家）`, "", `
    ${sheetSearchBar("搜索企业名称…")}
    <div class="muted" style="font-size:13.5px;margin-bottom:9px">${cfg.tip}</div>
    <div class="tbl-wrap-x"><table class="tbl" style="min-width:380px">
      <thead><tr><th>#</th><th>企业名称</th><th>类型</th><th class="num">营收</th><th class="num">税收</th><th class="num">用电</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty">暂无企业</div></td></tr>'}</tbody>
      ${list.length ? `<tfoot><tr><td colspan="3">合计</td><td class="num">${fmt(S("revenue_2025"), 0)}</td><td class="num">${fmt(S("tax_2025"), 0)}</td><td class="num">${fmt(S("energy_2025"), 0)}</td></tr></tfoot>` : ""}
    </table></div>
    <div class="muted" style="font-size:12.5px;margin-top:8px">营收 / 税收单位：万元　用电：万kwh（均为 2025 年数据）</div>`);
};

/* --- 预警企业名单 --- */
window.showWarnList = function () {
  const list = (state.enterprises || []).filter(isWarnFirm)
    .sort((a, b) => ((N(b.revenue_h1_2025) - N(b.revenue_2026)) / Math.abs(N(b.revenue_h1_2025) || 1)) - ((N(a.revenue_h1_2025) - N(a.revenue_2026)) / Math.abs(N(a.revenue_h1_2025) || 1)));
  const rows = list.map((f) => {
    const a = N(f.revenue_h1_2025), b = N(f.revenue_2026);
    const pct = a > 0 ? (b - a) / a * 100 : 0;
    return `<div class="mgr-item filter-item" data-kw="${esc(f.name)}" onclick="openEntModal(${f.id},'warn',false)">
      <div class="nm">${esc(f.name)} <span class="tag orange">预警</span></div>
      <div class="mt2">${esc(f.industry || "—")} · ${esc(f.location || "—")} · ${esc(pianquLabel(f.target_pianqu))}</div>
      <div class="mt2">2025年1-7月 ${fmt(a, 1)} 万　→　2026年1-7月 ${fmt(b, 1)} 万　<b style="color:var(--red)">${pct.toFixed(1)}%</b></div>
      <div class="mt2" style="color:var(--primary)">点击查看详情与原因分析 ›</div></div>`;
  }).join("");
  openSheet(`⚠️ 预警企业名单（${list.length} 家）`, "", `
    ${sheetSearchBar("搜索企业名称…")}
    <div class="muted" style="font-size:13.5px;margin-bottom:9px">口径：2026 年 1-7 月营收较 2025 年同期下滑超 10%（半停产企业不参与）。</div>
    ${rows || '<div class="empty">暂无预警企业</div>'}`);
};

/* ================= 企业弹窗（基本信息 / 比较分析 / 预警分析） ================= */
let curEnt = null;
window.openEntModal = function (id, from, noWarn) {
  const e = byId()[id]; if (!e) return;
  curEnt = e;
  const back = (from === "warn") ? "showWarnList()"
    : (typeof from === "string" && from.indexOf("kpi:") === 0) ? "showKpiList('" + from.slice(4) + "')" : "";
  entFrom = from; entBack = back ? new Function(back) : null;
  const warnTab = noWarn ? "" : `<button class="ent-tab" id="entTabWarn" onclick="entTabSwitch('warn')">⚠️ 预警分析</button>`;
  const tabs = `<button class="ent-tab active" id="entTabCmp" onclick="entTabSwitch('cmp')">📊 企业比较分析</button>${warnTab}`;
  openSheet(`🏢 ${e.name}`, tabs, entCmpBody(e) + (back ? `<div style="margin-top:14px"><button class="btn btn-ghost" onclick="${back}">← 返回名单</button></div>` : ""));
  if (isAdmin()) {
    $("#sheetTabs").insertAdjacentHTML("beforeend", `<button class="ent-tab" style="background:#fff3e0;color:var(--orange);border-color:#ffe0b2" onclick="editEnterprise(${e.id})">✏️ 编辑</button>`);
  }
};
let entFrom = null, entBack = null;
window.entTabSwitch = function (tab) {
  const e = curEnt; if (!e) return;
  const c = $("#entTabCmp"), w = $("#entTabWarn");
  if (c) c.classList.toggle("active", tab === "cmp");
  if (w) w.classList.toggle("active", tab === "warn");
  const backBtn = entBack ? `<div style="margin-top:14px"><button class="btn btn-ghost" onclick="backToList()">← 返回名单</button></div>` : "";
  if (tab === "warn") $("#sheetBody").innerHTML = entWarnBody(e) + backBtn;
  else $("#sheetBody").innerHTML = entCmpBody(e) + backBtn;
};
window.backToList = function () { if (entBack) entBack(); else closeSheet(); };

function entWarnBody(e) {
  const isHalf = (e.op_status || "") === "半停产";
  const a = N(e.revenue_h1_2025), b = N(e.revenue_2026);
  const pct = a > 0 ? (b - a) / a * 100 : null;
  const isWarn = !isHalf && pct != null && pct < -10;
  const head = isHalf
    ? `<div class="alert-box info">ℹ️ 该企业为<b>半停产</b>状态，不参与预警企业统计。</div>`
    : isWarn
    ? `<div class="alert-box warn">⚠️ 该企业<b>已触发营收预警</b>：2026 年 1-7 月营收较 2025 年同期下滑 <b>${fmt(Math.abs(pct), 1)}%</b>。</div>`
    : `<div class="alert-box info">该企业当前<b>未触发</b>营收预警（同比 ${pct == null ? "—" : (pct < 0 ? "下滑 " + fmt(Math.abs(pct), 1) + "%" : "增长 " + fmt(pct, 1) + "%")}，未超 10% 预警线）。</div>`;
  const row = (label, key) => `<div class="ent-kv"><span class="ent-k">${label}</span><span class="ent-v">${txt(e[key])}</span></div>`;
  return head + `<div class="cmp-box" style="margin:0">
    <h4 style="text-align:left">📋 预警分析与帮扶台账</h4>
    <div class="ent-kv"><span class="ent-k">营收对比</span><span class="ent-v">2025年1-7月 ${fmt(a, 1)} 万　→　2026年1-7月 ${fmt(b, 1)} 万</span></div>
    ${row("下滑原因", "warn_reason")}${row("存在问题", "warn_problem")}${row("已采取措施", "warn_action")}${row("需帮扶事项", "warn_help")}
  </div>`;
}
function entCmpBody(e) {
  const a = N(e.revenue_h1_2025), b = N(e.revenue_2026);
  const pct = a > 0 ? (b - a) / a * 100 : null;
  const isHalf = (e.op_status || "") === "半停产";
  const note = isHalf
    ? `<div class="cmp-note">ℹ️ 该企业为<b>半停产</b>状态，不参与预警企业统计。</div>`
    : (pct != null && pct < -10)
    ? `<div class="alert-box warn" style="margin-top:10px">⚠️ <b>营收预警</b>：2026 年 1-7 月营收较 2025 年同期下滑 <b>${fmt(Math.abs(pct), 1)}%</b>，超过 10% 预警线。</div>`
    : (pct != null && pct < 0 ? `<div class="cmp-note">📉 营收较去年同期下滑 ${fmt(Math.abs(pct), 1)}%（未超 10% 预警线）。</div>` : "");
  return barChart("营业收入（万元）", a, b) + barChart("税收（万元）", N(e.tax_h1_2025), N(e.tax_2026))
    + `<div class="cmp-note">口径：营业收入 / 税收为 <b>2025 年 1-7 月</b> 与 <b>2026 年 1-7 月</b> 累计数。营收同比下滑超 10% 触发预警。</div>${note}`;
}
function barChart(title, v25, v26) {
  const W = 320, H = 190, padL = 46, padB = 30, padT = 22;
  const base = H - padB, top = padT;
  const mx = Math.max(N(v25), N(v26), 1) * 1.18;
  const h = (v) => (N(v) / mx) * (base - top);
  const bw = 30, gap = 26, cx = (W + padL) / 2;
  const x25 = cx - bw - gap / 2, x26 = cx + gap / 2;
  const y25 = base - h(v25), y26 = base - h(v26);
  const grid = [0, .25, .5, .75, 1].map((r) => {
    const y = base - r * (base - top);
    return `<line x1="${padL}" y1="${y}" x2="${W - 6}" y2="${y}" stroke="#eef1f5"/>
      <text x="${padL - 5}" y="${y + 4}" font-size="9" fill="#8b95a3" text-anchor="end">${fmt(mx * r, 0)}</text>`;
  }).join("");
  return `<div class="cmp-box"><h4>${title}</h4>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      ${grid}
      <rect x="${x25}" y="${y25}" width="${bw}" height="${Math.max(h(v25), 1)}" rx="3" fill="#1f6feb"/>
      <text x="${x25 + bw / 2}" y="${y25 - 5}" font-size="11" fill="#1f2329" text-anchor="middle" font-weight="700">${fmt(v25, 1)}</text>
      <rect x="${x26}" y="${y26}" width="${bw}" height="${Math.max(h(v26), 1)}" rx="3" fill="#f08c00"/>
      <text x="${x26 + bw / 2}" y="${y26 - 5}" font-size="11" fill="#1f2329" text-anchor="middle" font-weight="700">${fmt(v26, 1)}</text>
      <line x1="${padL}" y1="${base}" x2="${W - 6}" y2="${base}" stroke="#d7dde5"/>
      <text x="${x25 + bw / 2}" y="${base + 15}" font-size="10" fill="#5b6572" text-anchor="middle">2025年1-7月</text>
      <text x="${x26 + bw / 2}" y="${base + 15}" font-size="10" fill="#5b6572" text-anchor="middle">2026年1-7月</text>
    </svg>
    <div style="display:flex;justify-content:center;gap:16px;font-size:12px;color:var(--sub);margin-top:4px">
      <span><i style="display:inline-block;width:9px;height:9px;background:#1f6feb;border-radius:2px"></i> 2025 年 1-7 月</span>
      <span><i style="display:inline-block;width:9px;height:9px;background:#f08c00;border-radius:2px"></i> 2026 年 1-7 月</span>
    </div></div>`;
}

/* ================= 县领导意见 ================= */
function renderLeader() {
  const L = state.leaderOpinion || {};
  renderNotices();
  $("#leaderOpinion").innerHTML = `
    <div class="lh">📝 ${esc(L.title || "县领导意见")}</div>
    <div class="lb">${esc(L.content || "（暂无意见）")}</div>
    ${L.updatedAt ? `<div class="muted" style="font-size:12px;margin-top:8px">更新时间：${esc(L.updatedAt)}</div>` : ""}`;
}
window.editLeader = function () {
  if (!canEditLeader()) return;
  const L = state.leaderOpinion || {};
  openModal("编辑县领导意见", `<textarea class="f-ta" id="ldContent" rows="8">${esc(L.content || "")}</textarea>`, () => {
    state.leaderOpinion = { title: L.title || "县领导意见", content: ($("#ldContent").value || "").trim(), updatedAt: todayStr() };
    saveState(); renderLeader();
  });
};

/* ---- 顶部滚动提示：县领导意见已填写 ---- */
function marquee(msgs, icon) {
  if (!msgs.length) return "";
  const group = msgs.map((m) => `<span>${icon} ${esc(m)}</span>`).join("");
  const chars = msgs.join("").length;
  const dur = Math.max(12, Math.round(chars * 0.42));
  return `<div class="notice"><div class="notice-track" style="animation-duration:${dur}s">${group}${group}</div></div>`;
}
function renderNotices() {
  const L = state.leaderOpinion || {};
  const has = (L.content || "").trim() !== "";
  const box = $("#noticeLeader");
  if (box) {
    box.innerHTML = has
      ? marquee(["县领导意见已填写，请及时查看"], "📢").replace("<div class=\"notice\"", "<div class=\"notice\" onclick=\"scrollToId('leaderOpinion')\"")
      : "";
  }
  const box2 = $("#noticeInvest");
  if (box2) {
    const msgs = (INVEST.projects || []).filter((p) => (p.leader_opinion || "").trim())
      .map((p) => `【${p.name}】县领导意见已填写，请及时查看`);
    box2.innerHTML = marquee(msgs, "📢");
  }
}
window.scrollToId = function (id) {
  const t = document.getElementById(id);
  if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
};

/* ================= 每周动态 ================
   动态全部由后台自行新增与编辑，不再与预警企业台账联动生成 */
function newsCard(n) {
  return `<div class="news${n.auto ? " auto" : ""}" onclick="this.classList.toggle('open')">
    <div class="top"><span>${esc(n.date || "")}</span></div>
    <div class="ti">${esc(n.title)}</div>
    <div class="su">${esc(n.summary || "")}</div>
    <div class="bd">${n.bodyHtml || esc(n.body || "")}</div>
    <div class="more">点击展开全文 ›</div>
  </div>`;
}
function renderWeekly() {
  const manual = (state.weeklyNews || []).map((n) => newsCard(n));
  $("#weeklyList").innerHTML = manual.length ? manual.join("") : `<div class="empty">暂无动态</div>`;
}

/* ================= 招商引资 =================
   内容与招商业务系统保持一致（服务端定时同步），H5 内只读展示 */
const INV_NODES = [
  { key: "declare", name: "信息申报",   icon: "📋", days: 0  },
  { key: "visit",   name: "重点跟进",   icon: "🔍", days: 10 },
  { key: "review",  name: "项目拟评审", icon: "🧾", days: 10 },
  { key: "sign",    name: "项目拟签约", icon: "✍️", days: 30 },
  { key: "signed",  name: "签约项目",   icon: "🤝", days: 30 }
];
const invNodeMeta = (k) => INV_NODES.find((n) => n.key === k) || { key: k, name: k || "未标注", icon: "📋", days: 0 };
function invNormDate(v) {
  if (v == null) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = String(v).trim(); if (!s) return "";
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function invWorkdayAdd(dateStr, n) {
  const start = invNormDate(dateStr); if (!start) return "";
  const d = new Date(start + "T00:00:00"); let k = 0;
  while (k < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) k++; }
  return d.toISOString().slice(0, 10);
}
function invDayDiff(a, b) {
  const s1 = invNormDate(a), s2 = invNormDate(b); if (!s1 || !s2) return 0;
  return Math.round((new Date(s2 + "T00:00:00") - new Date(s1 + "T00:00:00")) / 86400000);
}
/* 蓝=正常推进，黄=超期 14 天内，红=超期 14 天以上 */
function invStatus(x) {
  const nd = invNormDate(x.node_date);
  if (!nd) return { level: "蓝", over: 0, due: "" };
  const wd = N(invNodeMeta(x.stage).days);
  if (!wd) return { level: "蓝", over: 0, due: "" };
  const due = invWorkdayAdd(nd, wd); if (!due) return { level: "蓝", over: 0, due: "" };
  const over = invDayDiff(due, todayStr());
  if (over > 14) return { level: "红", over, due };
  if (over > 0) return { level: "黄", over, due };
  return { level: "蓝", over: 0, due };
}
const INV_LEVEL_TXT = { "蓝": "正常推进", "黄": "进度缓慢", "红": "严重推迟" };
const INV_LV = { "蓝": "blue", "黄": "yellow", "红": "red" };
const INV_LEVEL_FULL = { "蓝": "蓝·正常推进", "黄": "黄·进度缓慢", "红": "红·严重推迟" };

let invTab = "news", invStage = "all", curInv = null, invDetailTabName = "info";
function renderInvest() {
  renderNotices();
  invTabSwitch(invTab);
}
window.invTabSwitch = function (tab) {
  invTab = tab;
  const a = $("#invTabNews"), b = $("#invTabProj");
  if (a) a.classList.toggle("active", tab === "news");
  if (b) b.classList.toggle("active", tab === "proj");
  const body = $("#invTabBody"); if (!body) return;
  body.innerHTML = (tab === "proj") ? invProjectsHTML() : invNewsHTML();
};
window.invPick = function (key) { invStage = key; invTabSwitch("proj"); };

function invNewsHTML() {
  const list = (INVEST.news || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (!list.length) return `<div class="card"><div class="empty">暂无招商动态</div></div>`;
  return list.map((n) => {
    const head = (n.company || n.project)
      ? `<div class="ti">${esc(n.company || n.project)}</div>` : "";
    return `<div class="news">
      <div class="top"><span>${esc(n.date || "")}</span>${n.project && n.company ? `<span class="wk">洽谈：${esc(n.project)}</span>` : ""}</div>
      ${head}
      <div class="su">${esc(n.content || "")}</div>
    </div>`;
  }).join("");
}

function invProjectsHTML() {
  const list = INVEST.projects || [];
  if (!list.length) return `<div class="card"><div class="empty">暂无招商项目</div></div>`;
  const st = { "蓝": 0, "黄": 0, "红": 0 };
  list.forEach((x) => { st[invStatus(x).level] = (st[invStatus(x).level] || 0) + 1; });
  const statBox = `<div class="inv-stats">
      <div class="inv-stat"><div class="n">${list.length}</div><div class="l">项目总数</div></div>
      <div class="inv-stat" onclick="showInvByLevel('蓝')"><div class="n" style="color:#1f6feb">${st["蓝"]}</div><div class="l">正常推进 ›</div></div>
      <div class="inv-stat" onclick="showInvByLevel('黄')"><div class="n" style="color:#f08c00">${st["黄"]}</div><div class="l">进度缓慢 ›</div></div>
      <div class="inv-stat" onclick="showInvByLevel('红')"><div class="n" style="color:#e03131">${st["红"]}</div><div class="l">严重推迟 ›</div></div>
    </div>`;
  const chips = `<div class="inv-chips">
      <button class="inv-chip${invStage === "all" ? " on" : ""}" onclick="invPick('all')">全部 ${list.length}</button>
      ${INV_NODES.map((n) => `<button class="inv-chip${invStage === n.key ? " on" : ""}" onclick="invPick('${n.key}')">${n.icon} ${n.name} ${list.filter((x) => x.stage === n.key).length}</button>`).join("")}
    </div>`;
  const shown = (invStage === "all" ? list : list.filter((x) => x.stage === invStage));
  const cards = shown.length ? shown.map(invCardHTML).join("")
    : `<div class="empty">该节点暂无项目</div>`;
  return statBox + chips + `<div class="inv-list">${cards}</div>
    <div class="muted" style="font-size:12.5px;margin:10px 2px 0">状态口径：按各节点标准工作日自动判定（信息申报不限；重点跟进 / 项目拟评审 10 个工作日；项目拟签约 / 签约项目 30 个工作日），超出 14 天内标黄，超 14 天以上标红。</div>`;
}
function invCardHTML(x) {
  const s = invStatus(x), m = invNodeMeta(x.stage);
  const amt = N(x.amount) ? wan(x.amount) : null;
  const cut = (s2) => { const t = String(s2 || "").replace(/\s+/g, " ").trim(); return t.length > 56 ? t.slice(0, 56) + "…" : t; };
  return `<div class="inv-item lv-${INV_LV[s.level]}" onclick="openInvDetail(${x.id})">
    <div class="ii-top"><b>${esc(x.name)}</b><span class="inv-badge lv-${INV_LV[s.level]}">${INV_LEVEL_FULL[s.level]}</span></div>
    <div class="ii-meta">📌 ${esc(m.name)}${x.node_date ? " · " + esc(x.node_date) : ""}${amt ? "　💰 " + amt.v + " " + amt.u : ""}</div>
    ${x.content ? `<div class="ii-sub">${esc(cut(x.content))}</div>` : ""}
    ${(x.leader_opinion || "").trim() ? `<div class="ii-op">💬 县领导意见已填写</div>` : ""}
  </div>`;
}
window.showInvByLevel = function (level) {
  const items = (INVEST.projects || []).filter((x) => invStatus(x).level === level);
  const body = items.length ? items.map((x, i) => `
    <div class="mgr-item" onclick="openInvDetail(${x.id})">
      <div class="nm">${i + 1}. ${esc(x.name)}</div>
      <div class="mt2">${esc(invNodeMeta(x.stage).name)}${x.node_date ? " · " + esc(x.node_date) : ""}${invStatus(x).over > 0 ? ` · 已推迟 ${invStatus(x).over} 天` : ""}</div>
    </div>`).join("") : `<div class="empty">暂无该项目</div>`;
  openSheet(`${level === "蓝" ? "🔵" : level === "黄" ? "🟡" : "🔴"} ${INV_LEVEL_TXT[level]}项目（${items.length} 个）`, "", body);
};
window.openInvDetail = function (id) {
  const x = (INVEST.projects || []).find((p) => p.id === id); if (!x) return;
  curInv = x; invDetailTabName = "info";
  const hasOp = (x.leader_opinion || "").trim() !== "";
  const tabs = `<button class="ent-tab active" id="ivTabInfo" onclick="invDetailTab('info')">📋 项目详情</button>`
    + `<button class="ent-tab" id="ivTabOp" onclick="invDetailTab('op')">💬 县领导意见${hasOp ? " ●" : ""}</button>`;
  openSheet(`🤝 ${x.name}`, tabs, invBodyInfo(x));
};
window.invDetailTab = function (tab) {
  const x = curInv; if (!x) return;
  invDetailTabName = tab;
  const a = $("#ivTabInfo"), b = $("#ivTabOp");
  if (a) a.classList.toggle("active", tab === "info");
  if (b) b.classList.toggle("active", tab === "op");
  $("#sheetBody").innerHTML = (tab === "op") ? invBodyOp(x) : invBodyInfo(x);
  $("#sheetBody").scrollTop = 0;
};
function invBodyInfo(x) {
  const s = invStatus(x), m = invNodeMeta(x.stage);
  const amt = N(x.amount) ? wan(x.amount) : null;
  const row = (k, v) => `<div class="ent-kv"><span class="ent-k">${k}</span><span class="ent-v">${v ? esc(v) : "—"}</span></div>`;
  const head = `<div class="alert-box ${s.level === "蓝" ? "info" : "warn"}">
      📌 当前节点：<b>${esc(m.name)}</b>（${m.days ? m.days + " 个工作日" : "不限"}）　|　状态：<b>${INV_LEVEL_FULL[s.level]}</b>
      ${s.due ? `<div style="margin-top:4px">应完成：${esc(s.due)}${s.over > 0 ? `　已推迟 ${s.over} 天` : ""}</div>` : `<div style="margin-top:4px">未设置进入本节点日期，视为按时推进</div>`}
    </div>`;
  return head + `<div class="cmp-box">
      <h4 style="text-align:left">📋 项目基本信息</h4>
      ${row("投资额", amt ? amt.v + " " + amt.u : "")}
      ${row("投资方所在地", x.location)}
      ${row("项目联系人", x.contact)}
      ${row("对接单位", x.unit)}
      ${row("对接领导", x.leader)}
      ${row("跟进人员", x.follower)}
      ${row("进入本节点日期", x.node_date)}
      ${row("推迟原因", x.delay_reason)}
    </div>
    <div class="cmp-box"><h4 style="text-align:left">🏢 投资方概况</h4>
      <div class="cmp-note" style="margin-top:0">${x.investor ? esc(x.investor) : "—"}</div></div>
    <div class="cmp-box"><h4 style="text-align:left">📝 项目内容</h4>
      <div class="cmp-note" style="margin-top:0">${x.content ? esc(x.content) : "—"}</div></div>
    <div class="cmp-box"><h4 style="text-align:left">🚧 项目进展</h4>
      <div class="cmp-note" style="margin-top:0">${x.note ? esc(x.note) : "—"}</div></div>`;
}
function invBodyOp(x) {
  const v = (x.leader_opinion || "").trim();
  if (!canEditLeader()) {
    return v
      ? `<div class="leader" style="border-left-color:var(--purple)">
           <div class="lh">📝 ${esc(x.name)}</div>
           <div class="lb">${esc(v)}</div></div>`
      : `<div class="empty">该项目暂无县领导意见</div>`;
  }
  return `<div class="leader" style="border-left-color:var(--purple);padding:0;background:transparent;box-shadow:none">
      <div class="lh" style="padding:0 0 7px">📝 ${esc(x.name)}</div></div>
    <textarea class="f-ta" id="invOpText" rows="6" placeholder="请填写县领导意见…">${esc(v)}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary" onclick="saveInvOpinion(${x.id})">保存意见</button>
      ${v ? `<button class="btn btn-ghost" onclick="clearInvOpinion(${x.id})">清空</button>` : ""}
    </div>`;
}
window.saveInvOpinion = function (id) {
  if (!canEditLeader()) return;
  const v = ($("#invOpText") && $("#invOpText").value || "").trim();
  state.investOpinions = state.investOpinions || {};
  state.investOpinions[id] = v;
  const x = (INVEST.projects || []).find((p) => p.id === id);
  if (x) x.leader_opinion = v;
  if (curInv && curInv.id === id) curInv.leader_opinion = v;
  saveState(); renderInvest();
  alert(v ? "已保存县领导意见" : "已清空县领导意见");
};
window.clearInvOpinion = function (id) {
  if (!canEditLeader()) return;
  if (!confirm("确认清空该项目的县领导意见？")) return;
  const t = $("#invOpText"); if (t) t.value = "";
  window.saveInvOpinion(id);
};

/* ================= 弹层基础 ================= */
function openSheet(title, tabsHtml, bodyHtml) {
  $("#sheetTitle").textContent = title;
  $("#sheetTabs").innerHTML = tabsHtml || "";
  $("#sheetTabs").style.display = tabsHtml ? "flex" : "none";
  $("#sheetBody").innerHTML = bodyHtml;
  $("#mask").classList.add("on"); $("#sheet").classList.add("on");
  $("#sheetBody").scrollTop = 0;
}
window.closeSheet = function () { $("#mask").classList.remove("on"); $("#sheet").classList.remove("on"); curEnt = null; curInv = null; };

let saveFn = null;
function openModal(title, bodyHtml, onSave) {
  $("#editTitle").textContent = title;
  $("#editBody").innerHTML = bodyHtml;
  saveFn = onSave;
  $("#editMask").classList.add("on");
}
window.closeModal = function () { $("#editMask").classList.remove("on"); saveFn = null; };
$("#editSave").addEventListener("click", () => { if (saveFn) { saveFn(); closeModal(); } });

/* ================= 管理后台 ================= */
window.openMgr = function (tab) {
  if (!isAdmin()) return;
  $("#mgr").classList.add("on");
  document.querySelectorAll(".mt").forEach((t) => t.classList.toggle("on", t.dataset.t === tab));
  const body = $("#mgrBody");
  if (tab === "overview") body.innerHTML = mgrOverview();
  else if (tab === "enterprise") body.innerHTML = mgrEnterprise();
  else if (tab === "weekly") body.innerHTML = mgrWeekly();
  else if (tab === "invest") body.innerHTML = mgrInvest();
  else if (tab === "leader") body.innerHTML = mgrLeader();
  else body.innerHTML = mgrData();
  body.scrollTop = 0;
};
window.closeMgr = function () { $("#mgr").classList.remove("on"); };

function mgrOverview() {
  const P = state.park;
  let editBanners = (P.banners || []);
  return `<div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>平台标题</div>
    <input class="f-in" id="ovTitle" value="${esc(state.title || "")}" placeholder="平台名称">
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="saveTitle()">保存标题</button></div>
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>园区简介</div>
    <textarea class="f-ta" id="ovDesc">${esc(P.desc || "")}</textarea>
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="saveOverview()">保存简介</button></div>
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>园区亮点（4 项）</div>
    ${(P.highlights || []).map((h, i) => `
      <div class="f-grid" style="margin-bottom:8px">
        <input class="f-in" id="hlI${i}" value="${esc(h.ico)}" placeholder="图标">
        <input class="f-in" id="hlT${i}" value="${esc(h.t)}" placeholder="标题">
      </div>
      <input class="f-in" id="hlD${i}" value="${esc(h.d)}" placeholder="描述" style="margin-bottom:10px">`).join("")}
    <button class="btn btn-primary" onclick="saveHighlights()">保存亮点</button>
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>轮播图（banner）</div>
    <div id="bnBox">${bannerList(P.banners || [])}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="f-in" id="bnUrl" placeholder="粘贴图片网址">
      <button class="btn-mini" style="flex-shrink:0" onclick="addBannerUrl()">添加</button>
    </div>
    <div style="margin-top:8px">
      <button class="btn-mini" onclick="document.getElementById('bnFile').click()">＋ 上传本地图片</button>
      <input type="file" id="bnFile" accept="image/*" style="display:none" onchange="uploadBanner(this)">
    </div>
  </div>`;
}
window.saveTitle = function () {
  if (!isAdmin()) return;
  state.title = ($("#ovTitle").value || "").trim() || state.title;
  saveState();
  $("#hdrTitle").textContent = state.title; document.title = state.title;
  alert("已保存");
};
window.addBannerUrl = function () {
  if (!isAdmin()) return;
  const v = ($("#bnUrl").value || "").trim(); if (!v) return;
  state.park.banners = state.park.banners || [];
  state.park.banners.push(v); $("#bnUrl").value = "";
  $("#bnBox").innerHTML = bannerList(state.park.banners);
  saveState(); renderHome();
};
window.delBanner = function (i) {
  if (!isAdmin()) return;
  (state.park.banners || []).splice(i, 1);
  $("#bnBox").innerHTML = bannerList(state.park.banners);
  saveState(); renderHome();
};
window.uploadBanner = function (input) {
  const f = input.files && input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const b64 = String(rd.result).split(",")[1] || "";
      const hdrs = { "Content-Type": "application/json" };
      if (AUTH_TOKEN) hdrs["Authorization"] = "Bearer " + AUTH_TOKEN;
  if (AUTH_TOKEN) hdrs["X-Auth-Token"] = AUTH_TOKEN;
      const r = await fetch("/api/upload", { method: "POST", headers: hdrs, body: JSON.stringify({ name: f.name, data: b64 }) });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || "上传失败");
      state.park.banners = state.park.banners || [];
      state.park.banners.push(j.url);
      $("#bnBox").innerHTML = bannerList(state.park.banners);
      saveState(); renderHome();
    } catch (err) { alert("上传失败：" + err.message); }
    input.value = "";
  };
  rd.readAsDataURL(f);
};
function bannerList(arr) {
  if (!arr || !arr.length) return '<div class="empty" style="padding:8px 0">暂无轮播图</div>';
  return arr.map((src, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <img src="${esc(src)}" style="width:64px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">
      <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(src)}</div>
      <button class="btn-mini danger" onclick="delBanner(${i})">删除</button>
    </div>`).join("");
}
window.saveOverview = function () {
  if (!isAdmin()) return;
  state.park.desc = $("#ovDesc").value.trim(); saveState(); renderHome(); alert("已保存");
};
window.saveHighlights = function () {
  if (!isAdmin()) return;
  (state.park.highlights || []).forEach((h, i) => {
    h.ico = $("#hlI" + i).value.trim(); h.t = $("#hlT" + i).value.trim(); h.d = $("#hlD" + i).value.trim();
  });
  saveState(); renderHome(); alert("已保存");
};

function mgrEnterprise() {
  const items = (state.enterprises || []).map((e) => `
    <div class="mgr-item">
      <div class="nm">${esc(e.name)}</div>
      <div class="mt2">${esc(e.industry || "—")} · ${esc(e.location || "—")} · 营收 ${fmt(e.revenue_2025, 0)} 万元</div>
      <div class="ops">
        <button class="btn-mini" onclick="editEnterprise(${e.id})">编辑</button>
        <button class="btn-mini danger" onclick="delEnterprise(${e.id})">删除</button>
      </div>
    </div>`).join("");
  return `<button class="btn btn-primary" style="margin-bottom:10px" onclick="editEnterprise(null)">+ 新增企业</button>${items}`;
}
window.delEnterprise = function (id) {
  if (!isAdmin()) return;
  const e = byId()[id]; if (!e) return;
  if (!confirm("确认删除企业「" + e.name + "」？删除后不可恢复。")) return;
  state.enterprises = state.enterprises.filter((x) => x.id !== id);
  saveState(); renderHome(); renderAnalysis(); closeDetail(); closeSheet();
  if ($("#mgr").classList.contains("on")) openMgr("enterprise");
};
const ENT_FIELDS = [
  ["name", "企业名称", "text"], ["industry", "所属行业", "text"], ["location", "地理位置", "text"],
  ["target_pianqu", "片区（1-10）", "num"], ["main_product", "主要产品", "text"],
  ["op_status", "经营状态", "text"], ["is_above_scale", "是否规上（1/0）", "num"], ["leader", "分包县领导", "text"],
  ["credit_code", "统一信用代码", "text"], ["employee_count", "从业人数", "num"], ["area_mu", "占地（亩）", "num"],
  ["certified_area", "办证亩数", "num"], ["fixed_assets", "固定资产（万元）", "num"],
  ["output_2025", "2025总产值（万元）", "num"], ["revenue_2025", "2025营收（万元）", "num"],
  ["revenue_h1_2025", "2025年1-7月营收", "num"], ["tax_2025", "2025税收（万元）", "num"],
  ["tax_h1_2025", "2025年1-7月税收", "num"], ["profit_2025", "2025利润（万元）", "num"],
  ["rd_2025", "2025研发（万元）", "num"], ["energy_2025", "2025用电（万kwh）", "num"],
  ["output_2026", "2026总产值（万元）", "num"], ["revenue_2026", "2026年1-7月营收", "num"],
  ["revenue_2026_07", "2026年7月营收", "num"], ["tax_2026", "2026年1-7月税收", "num"],
  ["tax_2026_07", "2026年7月税收", "num"], ["profit_2026", "2026年1-7月利润", "num"],
  ["energy_2026", "2026年1-7月用电", "num"], ["production_capacity", "年生产能力", "text"],
  ["honors", "所获荣誉", "text"], ["brand", "品牌", "text"],
  ["other_honors", "其他荣誉", "text"], ["trademark", "商标", "text"],
  ["warn_reason", "预警下滑原因", "text"], ["warn_problem", "存在问题", "text"],
  ["warn_action", "已采取措施", "text"], ["warn_help", "需帮扶事项", "text"]
];
/* 企业实景图：支持粘贴网址或上传本地图片（上传需连接同步服务） */
function photoBox(list) {
  if (!list.length) return `<div class="muted" style="font-size:13px">暂无图片</div>`;
  return list.map((src, i) =>
    `<span class="ph-item"><img src="${esc(src)}"><button class="ph-del" onclick="delPhoto(${i})">×</button></span>`).join("");
}
window.delPhoto = function (i) {
  editPhotos.splice(i, 1); $("#phBox").innerHTML = photoBox(editPhotos);
};
window.addPhotoUrl = function () {
  const v = ($("#phUrl").value || "").trim(); if (!v) return;
  editPhotos.push(v); $("#phUrl").value = ""; $("#phBox").innerHTML = photoBox(editPhotos);
};
window.uploadPhoto = function (input) {
  const f = input.files && input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const b64 = String(rd.result).split(",")[1] || "";
      const hdrs = { "Content-Type": "application/json" };
      if (AUTH_TOKEN) hdrs["Authorization"] = "Bearer " + AUTH_TOKEN;
  if (AUTH_TOKEN) hdrs["X-Auth-Token"] = AUTH_TOKEN;
      const r = await fetch("/api/upload", {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ name: f.name, data: b64 })
      });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || "上传失败");
      editPhotos.push(j.url); $("#phBox").innerHTML = photoBox(editPhotos);
    } catch (err) {
      alert("上传失败：" + err.message + "\n未连接同步服务时无法上传，可改用「粘贴图片网址」。");
    }
    input.value = "";
  };
  rd.readAsDataURL(f);
};
let editPhotos = [];
window.editEnterprise = function (id) {
  if (!isAdmin()) return;
  const e = id ? byId()[id] : { id: Date.now(), name: "", industry: "", location: "南区" };
  editPhotos = Array.isArray(e.photos) ? e.photos.slice() : [];
  const body = `<div class="f-grid">` + ENT_FIELDS.map((f) => {
    const v = e[f[0]] === null || e[f[0]] === undefined ? "" : e[f[0]];
    return `<div class="f-row"><label>${f[1]}</label><input class="f-in" id="ef_${f[0]}" value="${esc(v)}" ${f[2] === "num" ? 'type="number" step="any"' : ""}></div>`;
  }).join("") + `</div>
  <div class="f-row"><label>企业介绍</label>
    <textarea class="f-ta" id="ef_intro" placeholder="企业简介、发展历程、主营业务等">${esc(e.intro || "")}</textarea></div>
  <div class="f-row"><label>企业实景图片（${editPhotos.length} 张）</label>
    <div id="phBox">${photoBox(editPhotos)}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="f-in" id="phUrl" placeholder="粘贴图片网址">
      <button class="btn-mini" style="flex-shrink:0" onclick="addPhotoUrl()">添加</button>
    </div>
    <div style="margin-top:8px">
      <button class="btn-mini" onclick="document.getElementById('phFile').click()">＋ 上传本地图片</button>
      <input type="file" id="phFile" accept="image/*" style="display:none" onchange="uploadPhoto(this)">
    </div>
  </div>`;
  openModal(id ? "编辑企业" : "新增企业", body, () => {
    ENT_FIELDS.forEach((f) => {
      const el = $("#ef_" + f[0]); if (!el) return;
      e[f[0]] = f[2] === "num" ? (el.value === "" ? null : Number(el.value)) : el.value.trim();
    });
    e.intro = ($("#ef_intro").value || "").trim();
    e.intro_edited = !!e.intro;          // 改过企业介绍 → 只显示所写内容，不再拼接补充字段
    e.photos = editPhotos.slice();
    if (!e.name) { alert("请填写企业名称"); return; }
    if (!id) state.enterprises.unshift(e);
    saveState(); renderHome(); renderAnalysis(); closeDetail(); closeSheet();
    if ($("#mgr").classList.contains("on")) openMgr("enterprise");
  });
};

function mgrWeekly() {
  const items = (state.weeklyNews || []).map((n, i) => `
    <div class="mgr-item">
      <div class="nm">${esc(n.title)}</div>
      <div class="mt2">${esc(n.date || "")}</div>
      <div class="ops">
        <button class="btn-mini" onclick="editWeekly(${i})">编辑</button>
        <button class="btn-mini danger" onclick="delWeekly(${i})">删除</button>
      </div>
    </div>`).join("");
  return `
    <div class="card">
      <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>每周动态</div>
      <div class="muted" style="font-size:13px;line-height:1.7;margin-bottom:10px">动态由后台自行新增与编辑，不再与预警企业台账联动生成。</div>
      <button class="btn btn-primary" style="margin-bottom:10px" onclick="editWeekly(-1)">+ 新增每周动态</button>
      ${items || '<div class="empty">暂无动态</div>'}
    </div>`;
}
window.editWeekly = function (idx) {
  if (!isAdmin()) return;
  const isNew = idx < 0;
  const n = isNew ? { date: todayStr(), week: "", title: "", summary: "", body: "" } : state.weeklyNews[idx];
  openModal(isNew ? "新增每周动态" : "编辑每周动态", `
    <div class="f-row"><label>标题</label><input class="f-in" id="wT" value="${esc(n.title)}"></div>
    <div class="f-row"><label>日期</label><input class="f-in" id="wD" value="${esc(n.date)}" placeholder="2026-09-01"></div>
    <div class="f-row"><label>摘要</label><input class="f-in" id="wS" value="${esc(n.summary || "")}"></div>
    <div class="f-row"><label>正文</label><textarea class="f-ta" id="wB">${esc(n.body || "")}</textarea></div>`, () => {
    const o = { title: $("#wT").value.trim(), date: $("#wD").value.trim(), summary: $("#wS").value.trim(), body: $("#wB").value };
    if (!o.title) { alert("请填写标题"); return; }
    if (isNew) state.weeklyNews.unshift(o); else state.weeklyNews[idx] = o;
    saveState(); renderWeekly(); openMgr("weekly");
  });
};
window.delWeekly = function (i) {
  if (!isAdmin()) return;
  if (!confirm("删除这条动态？")) return;
  state.weeklyNews.splice(i, 1); saveState(); renderWeekly(); openMgr("weekly");
};

function mgrInvest() {
  const list = INVEST.projects || [], news = INVEST.news || [];
  const st = { "蓝": 0, "黄": 0, "红": 0 };
  list.forEach((x) => { st[invStatus(x).level] = (st[invStatus(x).level] || 0) + 1; });
  const byNode = INV_NODES.map((n) => `<div class="ent-kv"><span class="ent-k">${n.icon} ${n.name}</span><span class="ent-v">${list.filter((x) => x.stage === n.key).length} 个</span></div>`).join("");
  const opList = list.filter((x) => (x.leader_opinion || "").trim());
  return `<div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>招商引资数据</div>
    <div class="muted" style="font-size:13.5px;line-height:1.8">
      当前共 <b>${list.length}</b> 个招商项目、<b>${news.length}</b> 条招商动态；
      正常推进 <b style="color:#1f6feb">${st["蓝"]}</b> · 进度缓慢 <b style="color:#f08c00">${st["黄"]}</b> · 严重推迟 <b style="color:#e03131">${st["红"]}</b>。
      其中 <b>${opList.length}</b> 个项目已填写县领导意见（首页顶部滚动提示）。
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary" onclick="invResync()">↻ 立即同步最新数据</button>
    </div>
    <div class="muted" style="font-size:12.5px;margin-top:8px">数据与招商业务系统保持一致，服务端每 10 分钟自动同步一次；在此处只读展示，如需修改请到招商业务系统操作。</div>
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>各节点项目数</div>
    ${byNode}
  </div>
  ${opList.length ? `<div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar warn"></span>已填写县领导意见的项目</div>
    ${opList.map((x) => `<div class="mgr-item" onclick="closeMgr();switchTab('invest');openInvDetail(${x.id});invDetailTab('op')">
      <div class="nm">${esc(x.name)}</div>
      <div class="mt2">${esc((x.leader_opinion || "").slice(0, 40))}${(x.leader_opinion || "").length > 40 ? "…" : ""}</div>
    </div>`).join("")}
  </div>` : ""}`;
}
window.invResync = function () {
  if (!CLOUD) { alert("未连接同步服务，无法拉取最新招商数据"); return; }
  fetch("/api/invest-sync", { method: "POST" }).then((r) => r.json()).then((d) => {
    if (d && d.investProjects) { setInvest(d); renderInvest(); }
    alert(d && d.ok ? "已同步最新招商数据（" + (d.investProjects || []).length + " 个项目）" : "同步未获取到新数据，当前展示的是最近一次成功同步的内容");
  }).catch(() => alert("同步失败，请稍后重试"));
};

function mgrLeader() {
  const L = state.leaderOpinion || {};
  return `<div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>县领导意见</div>
    <textarea class="f-ta" id="ldContent2">${esc(L.content || "")}</textarea>
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="saveLeader2()">保存</button></div>
  </div>`;
}
window.saveLeader2 = function () {
  if (!canEditLeader()) return;   // 开发区 / 后台 均可填写
  state.leaderOpinion = { title: "县领导意见", content: ($("#ldContent2").value || "").trim(), updatedAt: todayStr() };
  saveState(); renderLeader(); alert("已保存");
};

/* ---- 数据：备份 / 恢复 / 重置（本地数据仅存本机，换设备需导出再导入） ---- */
function mgrData() {
  let n = 0;
  try { const s = localStorage.getItem(LS_STATE); n = s ? s.length : 0; } catch (e) {}
  const syncTxt = CLOUD
    ? `<b style="color:var(--green)">已连接同步服务</b>：改动会自动保存到服务器，其他设备登录即为最新数据。`
    : `<b style="color:var(--orange)">未连接同步服务</b>：改动只保存在本机浏览器，其他设备看不到。
       请用 <code>python3 server.py</code> 启动服务后访问（而不是直接打开 html 文件）。`;
  return `<div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>多设备同步</div>
    <div class="muted" style="font-size:13.5px;line-height:1.8">${syncTxt}</div>
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar"></span>数据备份</div>
    <div class="muted" style="font-size:13.5px;line-height:1.8">
      当前数据约 ${(n / 1024).toFixed(1)} KB。导出备份可在其他设备导入，也用于误删后恢复。
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary" onclick="exportData()">导出备份</button>
      <button class="btn btn-ghost" onclick="document.getElementById('impFile').click()">导入备份</button>
    </div>
    <input type="file" id="impFile" accept=".json,application/json" style="display:none" onchange="importData(this)">
  </div>
  <div class="card">
    <div class="section-title" style="margin:0 0 8px"><span class="bar warn"></span>恢复初始数据</div>
    <div class="muted" style="font-size:13.5px;line-height:1.8">丢弃本机所有修改，还原为初始的 75 家企业与原始动态、意见。</div>
    <button class="btn btn-danger" style="margin-top:10px" onclick="resetData()">重置为初始数据</button>
  </div>`;
}
window.exportData = function () {
  const blob = new Blob([localStorage.getItem(LS_STATE) || "{}"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "广平经开区数据备份-" + todayStr() + ".json";
  a.click(); URL.revokeObjectURL(a.href);
};
window.importData = function (input) {
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(r.result);
      if (!o || !Array.isArray(o.enterprises)) throw new Error("文件格式不正确");
      state.park = Object.assign(state.park, o.park || {});
      state.enterprises = o.enterprises;
      state.weeklyNews = o.weeklyNews || state.weeklyNews;
      state.leaderOpinion = o.leaderOpinion || state.leaderOpinion;
      state.investOpinions = o.investOpinions || {};
      setInvest(state);
      saveState(); renderHome(); renderAnalysis(); renderWeekly(); renderInvest();
      alert("导入成功，共 " + o.enterprises.length + " 家企业");
      openMgr("data");
    } catch (e) { alert("导入失败：" + e.message); }
    input.value = "";
  };
  r.readAsText(f);
};
window.resetData = function () {
  if (!isAdmin()) return;
  if (!confirm("将丢弃全部修改，恢复初始数据。其他设备也会同步为初始数据，确定继续？")) return;
  state = JSON.parse(JSON.stringify(window.BASE_DATA));
  saveState();                       // 同时写入本机与服务端，多设备一致
  renderHome(); renderAnalysis(); renderWeekly();
  alert("已恢复初始数据");
  openMgr("data");
};

/* ================= 启动 =================
   先探测同步服务：连得上就拉服务端数据（多设备共享），连不上退回本机 localStorage。 */
async function detectCloud() {
  try { const r = await fetch("/api/ping", { cache: "no-store" }); return r.ok; } catch (e) { return false; }
}
async function pullCloud() {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
(async function boot() {
  CLOUD = await detectCloud();
  if (CLOUD) {
    try { state = await pullCloud(); setInvest(state); }
    catch (e) { state = loadState(); CLOUD = false; }
  } else {
    state = loadState();
  }
  setInvest(state);
  try {
    const s = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
    if (s && ACCOUNTS[s.username]) {
      session = s;
      AUTH_TOKEN = s.token || null;
      // 连上同步服务但本地没有有效令牌：清除会话，要求重新登录以获取写权限
      if (CLOUD && !AUTH_TOKEN) { session = null; localStorage.removeItem(LS_SESSION); }
      else { enterApp(); return; }
    }
  } catch (e) {}
})();

})();
