/* 广平经济开发区服务平台 · 云端后端（零依赖 Node http）
 * 复刻前端所需的 5 个接口，数据持久化到磁盘，发布后始终在线。
 * 监听 process.env.PORT（发布脚本注入），绑定 0.0.0.0。
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
// 数据目录优先级：显式 DATA_DIR > Railway 持久卷(RAILWAY_VOLUME_MOUNT_PATH) > 沙箱共享目录 > 应用内 data/
// —— Railway 上加一个 Volume 并挂载，数据即可跨重启持久化，无需改动代码。
const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || (fs.existsSync("/workspace/gp_app/data") ? "/workspace/gp_app/data" : path.join(ROOT, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SEED_FILE = path.join(ROOT, "seed.json");
const PORT = Number(process.env.PORT) || 3000;

// 确保数据目录与初始文件就绪：Railway 等 ephemeral 环境首次启动用 seed 初始化，
// 若已挂持久卷则从卷内读写，重启不丢数据。
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    try { fs.copyFileSync(SEED_FILE, STATE_FILE); console.log("[init] 已从种子初始化 state.json"); } catch (e) {}
  }
  const invStatic = path.join(ROOT, "assets", "invest_data.js");
  const invFile = path.join(DATA_DIR, "invest.json");
  if (!fs.existsSync(invFile)) { try { fs.copyFileSync(invStatic, invFile); } catch (e) {} }
} catch (e) { console.log("[init-warn] " + (e && e.message)); }

/* ---- 账号（与前端 ACCOUNTS 保持一致） ---- */
const ACCOUNTS = {
  "开发区": { pwd: "123123", role: "dev",   display: "开发区" },
  "后台":   { pwd: "123123", role: "admin", display: "后台"   }
};
// 无状态令牌：token = base64url(username + "|" + SECRET)。
// 任意实例都能独立校验，不依赖共享内存，兼容云端多实例部署。
const SECRET = "gp_edz_cloud_2026_secret_v1";
function makeToken(username) { return Buffer.from(username + "|" + SECRET).toString("base64url"); }
function validToken(t) {
  if (!t) return null;
  try {
    const s = Buffer.from(t, "base64url").toString("utf8");
    const i = s.lastIndexOf("|");
    if (i < 0) return null;
    const u = s.slice(0, i), sec = s.slice(i + 1);
    if (sec !== SECRET) return null;
    return ACCOUNTS[u] ? u : null;
  } catch (e) { return null; }
}

/* ---- 工具 ---- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2"
};
function sendJSON(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate" });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { chunks.push(c); size += c.length; if (size > 32 * 1024 * 1024) req.destroy(); });
    // 必须先把所有分片攒成 Buffer 再统一按 UTF-8 解码，否则多字节中文被 TCP 分片切断时会出乱码。
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function getToken(req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
// 网关会改写 Authorization 头（注入自家 JWT），但自定义头 X-Auth-Token 原样透传。
// 因此优先用 X-Auth-Token 校验，Authorization 仅作兜底。
function authUser(req) {
  const candidates = [req.headers["x-auth-token"], getToken(req)];
  for (const c of candidates) { const u = validToken(c); if (u) return u; }
  return null;
}
function loadState() {
  try {
    const txt = fs.readFileSync(STATE_FILE, "utf8");
    if (/\uFFFD/.test(txt)) throw new Error("corrupted");   // 含乱码则回落干净种子，避免前端出现问号
    return JSON.parse(txt);
  } catch (e) { return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); }
}
function saveState(obj) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
}

/* ---- 招商引资数据：从招商业务系统同步（H5 内只读展示） ---- */
const INVEST_FILE = path.join(DATA_DIR, "invest.json");
const INVEST_STATIC = path.join(ROOT, "assets", "invest_data.js");
const REF_BASE = "https://accd6dd958c86bb9c.app.workbuddy.link";
const REF_USER = "临时读取账号勿用";
const REF_PWD = "gp123456";
let REF_COOKIE = "";

function readStaticInvest() {
  try {
    const t = fs.readFileSync(INVEST_STATIC, "utf8")
      .replace(/^\s*window\.INVEST_DATA\s*=/, "").replace(/;\s*$/, "");
    return JSON.parse(t);
  } catch (e) { return { investProjects: [], investNews: [] }; }
}
function loadInvest() {
  try {
    const o = JSON.parse(fs.readFileSync(INVEST_FILE, "utf8"));
    if (o && Array.isArray(o.investProjects) && o.investProjects.length) return o;
  } catch (e) {}
  return readStaticInvest();
}
function refRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(REF_BASE + urlPath);
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const headers = { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": "gp-edz-h5/1.0" };
    if (REF_COOKIE) headers.Cookie = REF_COOKIE;
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = payload.length; }
    const mod = u.protocol === "http:" ? http : https;
    const r = mod.request({ protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + (u.search || ""),
      method, headers, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("timeout")));
    if (payload) r.write(payload);
    r.end();
  });
}
async function refLogin() {
  const r = await refRequest("POST", "/api/login", { username: REF_USER, password: REF_PWD });
  const sc = r.headers && r.headers["set-cookie"];
  if (sc && sc.length) REF_COOKIE = sc.map((s) => String(s).split(";")[0]).join("; ");
  const j = JSON.parse(r.body);
  return j && j.code === 0;
}
async function refGet(urlPath) {
  let r = await refRequest("GET", urlPath);
  let j = null;
  try { j = JSON.parse(r.body); } catch (e) {}
  if ((!j || j.code !== 0) && REF_COOKIE) {   // 会话过期：重新登录再取一次
    REF_COOKIE = "";
    if (await refLogin()) { r = await refRequest("GET", urlPath); try { j = JSON.parse(r.body); } catch (e) {} }
  }
  return j && j.code === 0 ? j.data : null;
}
const INV_KEEP = ["id", "stage", "name", "location", "investor", "contact", "content",
                  "amount", "unit", "note", "node_date", "delay_reason", "leader", "follower", "leader_opinion"];
async function syncInvest() {
  try {
    if (!REF_COOKIE) await refLogin();
    const proj = await refGet("/api/investment");
    const news = await refGet("/api/investment-news");
    if (!proj || !proj.length) return false;
    const data = {
      syncedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      investProjects: proj.filter((x) => !String(x.name || "").startsWith("__"))
        .map((x) => { const o = {}; INV_KEEP.forEach((k) => o[k] = x[k] == null ? "" : x[k]); return o; }),
      investNews: (news || []).map((x) => ({
        id: x.id, date: x.date || "", company: x.company || "",
        project: x.project || "", content: x.content || "", author: x.created_by || ""
      }))
    };
    fs.writeFileSync(INVEST_FILE, JSON.stringify(data));
    console.log("[invest] 已同步 " + data.investProjects.length + " 个项目 / " + data.investNews.length + " 条动态");
    return true;
  } catch (e) {
    console.log("[invest] 同步失败：" + e.message + "（继续使用最近一次成功同步的数据）");
    return false;
  }
}
// 招商数据同步失败只影响展示的时效性，绝不允许把进程拖垮
process.on("uncaughtException", (e) => console.log("[ignore] " + (e && e.message)));
process.on("unhandledRejection", (e) => console.log("[ignore-rej] " + (e && e.message)));
// 招商数据定时同步（已排查确认与网关 502 无关）；后台「立即同步」按钮可随时手动触发
if (process.env.INVEST_AUTOSYNC !== "0") {
  setInterval(() => { syncInvest().catch(() => {}); }, 10 * 60 * 1000);
  setTimeout(() => { syncInvest().catch(() => {}); }, 3000);
}

/* ---- 静态文件 ---- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  // 防目录穿越
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404 Not Found"); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---- 路由 ---- */
const server = http.createServer(async (req, res) => {
  const urlPath = req.url || "/";
  const pathname = urlPath.split("?")[0];

  // 上传目录静态服务
  if (pathname.startsWith("/data/uploads/")) return serveStatic(req, res, pathname);

  // API
  if (pathname === "/api/ping") { res.writeHead(200); res.end("ok"); return; }

  if (pathname === "/api/login" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const acc = ACCOUNTS[body.username];
      if (!acc || acc.pwd !== body.password) return sendJSON(res, 401, { error: "账号或密码错误" });
      const token = makeToken(body.username);
      return sendJSON(res, 200, { token, role: acc.role, display: acc.display });
    } catch (e) { return sendJSON(res, 400, { error: "请求格式错误" }); }
  }

  if (pathname === "/api/state" && req.method === "GET") {
    const st = loadState();
    const inv = loadInvest();
    // 本平台内填写的县领导意见优先于招商系统同步来的原始值
    const ov = st.investOpinions || {};
    if (Object.keys(ov).length && Array.isArray(inv.investProjects)) {
      inv.investProjects = inv.investProjects.map((p) =>
        (p && ov[p.id] !== undefined) ? Object.assign({}, p, { leader_opinion: ov[p.id] }) : p);
    }
    return sendJSON(res, 200, Object.assign({}, st, inv));
  }

  if (pathname === "/api/invest-sync" && req.method === "POST") {
    const ok = await syncInvest();
    return sendJSON(res, 200, Object.assign({ ok }, loadInvest()));
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    if (!authUser(req)) return sendJSON(res, 401, { error: "未登录或登录已失效" });
    try {
      const obj = JSON.parse(await readBody(req) || "{}");
      if (!obj || !Array.isArray(obj.enterprises)) return sendJSON(res, 400, { error: "数据格式不正确" });
      delete obj.investProjects; delete obj.investNews;   // 招商数据由同步任务维护，不被前端回写覆盖
      saveState(obj);
      return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 400, { error: "保存失败：" + e.message }); }
  }

  if (pathname === "/api/upload" && req.method === "POST") {
    if (!authUser(req)) return sendJSON(res, 401, { error: "未登录或登录已失效" });
    try {
      const obj = JSON.parse(await readBody(req) || "{}");
      const b64 = String(obj.data || "").replace(/^data:.*;base64,/, "");
      if (!b64) return sendJSON(res, 400, { error: "空文件" });
      const ext = (String(obj.name || "").split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      const fname = Date.now() + "_" + crypto.randomBytes(4).toString("hex") + "." + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(b64, "base64"));
      return sendJSON(res, 200, { url: "/data/uploads/" + fname });
    } catch (e) { return sendJSON(res, 400, { error: "上传失败：" + e.message }); }
  }

  // 其余走静态
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, pathname);

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("广平经开区服务平台云端后端已启动，端口 " + PORT);
});
