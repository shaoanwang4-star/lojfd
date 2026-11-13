
/* ==========================================================================
   漫阁 —— 单文件漫画阅读站（登录 / 上传 / 编辑 / 版权 / 弹幕 / 好友）
   本文件是唯一代码文件；firestore.rules 与 storage.rules 是服务端策略配置。
   ========================================================================== */

/* ---------- 0. 配置 ---------- */
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
const V = "12.6.0";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = (m, ms = 2600) => { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };
const now = () => Date.now();

if (Object.values(firebaseConfig).some(v => String(v).startsWith("PASTE_"))) {
  $("#view").innerHTML = `<div class="setup card"><h2>接入你的 Firebase 项目</h2>
  <p class="hint">① 打开本文件顶部的 <b>firebaseConfig</b>，把控制台「项目设置 → 你的应用 → SDK 设置」的 6 个字段粘进来：</p>
  <pre>const firebaseConfig = {
  apiKey:            "AIza...",                        // 必需
  authDomain:        "PROJECT.firebaseapp.com",       // 必需
  projectId:         "PROJECT",                        // 必需
  storageBucket:     "PROJECT.firebasestorage.app",    // 必需
  messagingSenderId: "1234567890",                     // 必需
  appId:             "1:1234567890:web:abcdef"         // 必需
};</pre>
  <p class="hint" style="margin-top:14px">② 控制台开启 <b>Authentication</b>（邮箱 + Google）、<b>Firestore</b>、<b>Storage</b>；Google 登录需把本站域名加入「授权域名」。</p>
  <p class="hint">③ 把 <b>firestore.rules</b>、<b>storage.rules</b> 的内容分别粘到「规则」页并发布。三级可见性和「只有作者能改自己的作品」由服务端规则强制，前端代码拦不住直接调 API 的人。</p>
  <p class="hint">④ 用 http 打开本页（登录弹窗在 <b>file://</b> 源下会被浏览器拦截）。在本目录执行 <code>npx -y serve .</code>，再访问 http://localhost:3000</p>
  </div>`;
  throw new Error("firebaseConfig 尚未填写");
}

const [App, Auth, FS, STO] = await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-storage.js`)
]);
const { addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } = FS;
const { deleteObject, getDownloadURL, ref: sref, uploadBytesResumable } = STO;

const app = App.initializeApp(firebaseConfig);
const A = Auth.getAuth(app), D = FS.getFirestore(app), St = STO.getStorage(app);

const LICENCES = ["© 保留所有权利", "CC BY-NC 4.0", "CC BY-NC-ND 4.0", "CC BY 4.0", "仅站内展示"];
const VIS = { public: "公开", friends: "仅好友", private: "仅自己" };

/* ---------- 1. 状态与数据入口 ---------- */
const G = { uid: null, me: null, route: "", unsubs: [], dm: [], page: 0, pages: [], shownAt: 0, danmakuOn: true };
const urlCache = new Map();

const C = {
  user: u => doc(D, "users", u),
  users: () => collection(D, "users"),
  comics: () => collection(D, "comics"),
  comic: id => doc(D, "comics", id),
  chapters: id => collection(D, "comics", id, "chapters"),
  chapter: (id, cid) => doc(D, "comics", id, "chapters", cid),
  dm: (id, cid) => collection(D, "comics", id, "chapters", cid, "danmaku"),
  fr: id => doc(D, "friendships", id),
  frs: () => collection(D, "friendships")
};
const pairId = (a, b) => [a, b].sort().join("_");
const myFriends = async () => {
  if (!G.uid) return [];
  const s = await getDocs(query(C.frs(), where("members", "array-contains", G.uid), limit(400)));
  return s.docs.filter(d => d.data().status === "accepted").map(d => d.data().members.find(u => u !== G.uid)).filter(Boolean);
};

const getUrl = async path => {
  if (!path) return "";
  if (urlCache.has(path)) return urlCache.get(path);
  try { const u = await getDownloadURL(sref(St, path)); urlCache.set(path, u); return u; } catch { return ""; }
};
/* 上传前压到长边 1600：手机原图 6~10MB，直传会瞬间吃满免费额度 */
const shrink = file => new Promise(res => {
  const img = new Image(), o = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
    const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(o);
    cv.toBlob(b => res(b || file), "image/jpeg", .82);
  };
  img.onerror = () => { URL.revokeObjectURL(o); res(file); };
  img.src = o;
});
const put = (blob, path, prog) => new Promise((res, rej) => {
  const t = uploadBytesResumable(sref(St, path), blob, { contentType: "image/jpeg" });
  t.on("state_changed", s => prog && prog(s.totalBytes ? s.bytesTransferred / s.totalBytes : 1), rej, () => res(path));
});
const prog = (bar, p) => { if (bar) $("i", bar).style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + "%"; };
/* 封面加载成功后去掉占位标题 */
const paintCov = (n, u) => { if (n && u) { n.style.backgroundImage = `url("${u}")`; n.textContent = ""; } };

/* ---------- 2. 顶栏与路由 ---------- */
const TABS = [["home", "发现"], ["studio", "创作台"], ["friends", "好友"]];
function paintHeader() {
  $("#nav").innerHTML = TABS.map(([id, n]) => `<a href="#/${id}" class="${G.route === id ? "on" : ""}">${n}</a>`).join("");
  $("#btnAuth").textContent = G.uid ? "退出" : "登录";
  const who = $("#who");
  who.hidden = !G.uid;
  who.innerHTML = G.uid ? `<span class="avt">${esc((G.me?.displayName || G.me?.handle || "?").slice(0, 1).toUpperCase())}</span> ${esc(G.me?.displayName || G.me?.handle || "已登录")}` : "";
}
const guard = () => { if (!G.uid) { toast("请先登录"); location.hash = "#/login"; return false; } return true; };
const drop = () => { G.unsubs.forEach(f => { try { f(); } catch { } }); G.unsubs = []; };

async function route() {
  drop();
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  G.route = p[0] || "home";
  paintHeader();
  const v = $("#view");
  if (G.route === "read") {
    viewReader(v, p[1], p[2]).catch(e => { $("#topbar").hidden = false; v.innerHTML = `<div class="empty">打开失败：${esc(e.message || e)}　<a href="#/home">回到发现</a></div>`; });
    return;   // 阅读器自绘整屏，不走下面的通用容器
  }
  v.innerHTML = `<div class="empty">加载中…</div>`;
  try {
    if (G.route === "studio") await viewStudio(v);
    else if (G.route === "friends") await viewFriends(v);
    else if (G.route === "login") viewLogin(v);
    else if (G.route === "comic") await viewComic(v, p[1]);
    else await viewHome(v);
  } catch (e) { v.innerHTML = `<div class="empty">加载失败：${esc(e.message || String(e))}</div>`; }
}

/* ---------- 3. 发现 ---------- */
async function viewHome(v) {
  const snap = await getDocs(query(C.comics(), where("visibility", "==", "public"), limit(180)));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  v.innerHTML = `<h2>发现</h2>
    <div class="row" style="margin-bottom:16px"><input id="q" placeholder="搜索标题 / 作者 / 标签" style="flex:1;min-width:200px"><span class="hint">${list.length} 部公开作品</span></div>
    <div id="grid" class="grid"></div>`;
  const draw = kw => {
    const k = kw.trim().toLowerCase();
    const hit = list.filter(c => !k || `${c.title}${c.authorName}${(c.tags || []).join(",")}${c.summary}`.toLowerCase().includes(k));
    $("#grid", v).innerHTML = hit.map(cardHTML).join("") || `<div class="empty" style="grid-column:1/-1">没有匹配的作品</div>`;
    $$("#grid .cmic", v).forEach(n => n.onclick = () => location.hash = "#/comic/" + n.dataset.id);
    hit.forEach(async c => paintCov($(`#grid [data-id="${c.id}"] .cov`, v), await getUrl(c.coverPath)));
  };
  draw("");
  $("#q", v).oninput = e => draw(e.target.value);
}
const cardHTML = c => `<div class="cmic" data-id="${esc(c.id)}"><div class="cov">${esc(c.title).slice(0, 8)}</div>
  <div class="cmeta"><div class="ct">${esc(c.title)}</div><div class="cs"><span>${esc(c.authorName || "")}</span>
  <span class="badge ${esc(c.visibility)}">${VIS[c.visibility] || ""}</span><span>${c.chapterCount || 0} 话</span></div></div></div>`;

/* ---------- 4. 作品详情 ---------- */
async function viewComic(v, id) {
  if (!id) return viewHome(v);
  let snap;
  try { snap = await getDoc(C.comic(id)); }
  catch { v.innerHTML = `<div class="empty">这是一部 <span class="badge friends">仅好友</span> 或 <span class="badge private">仅自己</span> 的作品，服务端规则拒绝了你读取。<a href="#/home">回到发现</a></div>`; return; }
  if (!snap.exists()) { v.innerHTML = `<div class="empty">作品不存在（作者可能已删除）。</div>`; return; }
  const c = { id: snap.id, ...snap.data() };
  const chs = (await getDocs(C.chapters(id))).docs.map(d => ({ cid: d.id, ...d.data() })).sort((a, b) => a.num - b.num);
  const mine = G.uid && c.ownerId === G.uid;
  v.innerHTML = `<button class="ghost sm" id="bk">← 返回发现</button>
    <div class="card" style="margin-top:12px;display:flex;gap:18px;flex-wrap:wrap">
      <div class="cov" id="cv" style="width:190px;flex:none;border-radius:10px">${esc(c.title).slice(0, 8)}</div>
      <div style="flex:1;min-width:250px">
        <h2 style="margin:0">${esc(c.title)} <span class="badge ${esc(c.visibility)}">${VIS[c.visibility] || ""}</span></h2>
        <div class="cs" style="margin:6px 0 12px">作者 ${esc(c.authorName || "—")} · ${c.chapterCount || chs.length} 话 · 更新于 ${new Date(c.updatedAtMs || 0).toLocaleDateString()}</div>
        <p style="white-space:pre-wrap;font-size:14px">${esc(c.summary || "暂无简介")}</p>
        <div class="row" style="margin-top:12px">${(c.tags || []).map(t => `<span class="pill">#${esc(t)}</span>`).join("")}</div>
        <div class="row" style="margin-top:16px">
          ${chs.length ? `<button id="go">开始阅读</button><button id="goLast" class="ghost">最新话</button>` : `<span class="hint">${mine ? "还没有页面，点「上传新话」开始。" : "作者还没有发布页面。"}</span>`}
          ${mine ? `<button id="edit" class="ghost">编辑信息</button><button id="addCh" class="ghost">上传新话</button><button id="delAll" class="danger">删除作品</button>` : ""}
        </div></div></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">版权与许可</h3>
      <div class="row"><span class="pill">许可：${esc(c.license || LICENCES[0])}</span><span class="pill">可见性：${VIS[c.visibility] || ""}</span>
      ${mine ? `<span class="pill">当前授权好友：${(c.friendUids || []).length} 人</span>` : ""}</div>
      <p class="hint" style="margin-top:8px">${esc(c.notice || "")}　阅读与图片下载权限由 Firestore / Storage 服务端规则校验。</p></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">目录</h3>${chs.length ? `<table><thead><tr><th>话</th><th>标题</th><th>页数</th><th></th></tr></thead><tbody>${
      chs.map(h => `<tr><td>第 ${h.num} 话</td><td>${esc(h.title)}</td><td class="hint">${(h.pages || []).length}</td>
      <td style="text-align:right"><button class="sm" data-c="${esc(h.cid)}">阅读</button>${mine ? ` <button class="sm ghost" data-dc="${esc(h.cid)}">删除</button>` : ""}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">暂无章节</div>`}</div>`;
  getUrl(c.coverPath).then(u => paintCov($("#cv", v), u));
  $("#bk", v).onclick = () => location.hash = "#/home";
  const open = ch => location.hash = `#/read/${id}/${ch.cid}`;
  if (chs.length) { $("#go", v).onclick = () => open(chs[0]); $("#goLast", v).onclick = () => open(chs[chs.length - 1]); }
  $$("[data-c]", v).forEach(b => b.onclick = () => location.hash = `#/read/${id}/${b.dataset.c}`);
  $$("[data-dc]", v).forEach(b => b.onclick = () => delChapter(id, b.dataset.dc).then(() => viewComic(v, id)));
  if (mine) {
    $("#edit", v).onclick = () => comicForm(c);
    $("#addCh", v).onclick = () => chapterForm(c);
    $("#delAll", v).onclick = async () => { if (confirm("删除整部作品及其所有章节页面？不可恢复。")) { await deleteComic(c); toast("已删除"); location.hash = "#/studio"; } };
  }
}

/* ---------- 5. 阅读器 + 弹幕 ---------- */
class DM {
  constructor(cv) { this.cv = cv; this.g = cv.getContext("2d"); this.items = []; this.ids = new Set(); this.laneH = 26; this.lanes = 8; this.last = now(); this.raf = null; }
  resize() {
    const p = this.cv.parentElement;
    this.cv.width = p.clientWidth || 1; this.cv.height = p.clientHeight || 1;
    this.laneH = Math.max(22, Math.round(this.cv.height / 16));
    this.lanes = Math.max(3, Math.floor((this.cv.height - 30) / this.laneH));
  }
  reset() { this.items = []; this.ids = new Set(); this.g.clearRect(0, 0, this.cv.width, this.cv.height); }
  spawn(d, delay = 0) {
    if (this.ids.has(d.id) || this.items.length > 220) return;
    this.ids.add(d.id);
    this.items.push({ id: d.id, text: String(d.text).slice(0, 50), color: /^#[0-9a-f]{3,8}$/i.test(d.color || "") ? d.color : "#fff",
      pos: d.pos === "top" ? "top" : "scroll", lane: Math.floor(Math.random() * this.lanes), t0: now() + delay, x: 0, w: 0, life: 4200 });
  }
  drop(id) { this.ids.delete(id); this.items = this.items.filter(i => i.id !== id); }
  start() { if (this.raf) return; const step = () => { this.tick(); this.raf = requestAnimationFrame(step); }; this.raf = requestAnimationFrame(step); }
  stop() { cancelAnimationFrame(this.raf); this.raf = null; }
  tick() {
    const g = this.g, W = this.cv.width, t = now(), dt = Math.min(60, t - this.last); this.last = t;
    g.clearRect(0, 0, W, this.cv.height);
    if (!G.danmakuOn) return;
    g.font = "600 17px system-ui,'PingFang SC','Microsoft YaHei',sans-serif"; g.textBaseline = "top";
    g.shadowColor = "rgba(0,0,0,.9)"; g.shadowBlur = 4;
    for (const i of this.items) {
      if (t < i.t0) continue;
      i.w = i.w || g.measureText(i.text).width + 6;
      g.shadowOffsetX = i.pos === "top" ? 0 : 1;
      if (i.pos === "top") {
        i.life -= dt; g.globalAlpha = Math.min(1, Math.max(0, i.life / 900)); g.fillStyle = i.color;
        g.fillText(i.text, (W - i.w) / 2, 6 + i.lane * this.laneH);
      } else {
        if (!i.x) i.x = W; i.x -= .11 * dt;
        g.globalAlpha = 1; g.fillStyle = i.color; g.fillText(i.text, i.x, this.laneH * i.lane + 4);
      }
    }
    g.globalAlpha = 1; g.shadowOffsetX = 0;
    this.items = this.items.filter(i => i.pos === "top" ? i.life > 0 : i.x + i.w > -30);
  }
}

async function viewReader(host, comicId, cid) {
  if (!comicId) { location.hash = "#/home"; return; }
  host.innerHTML = `<div id="reader">
    <div id="rbar">
      <button class="ghost sm" id="back">← 返回</button><b id="rt">…</b>
      <select id="chSel" class="ghost sm"></select>
      <span class="spacer"></span><span id="pg" class="pill">- / -</span>
      <input id="jump" type="range" min="0" max="0" value="0" style="width:140px">
      <button class="ghost sm" id="dmOn">弹幕：开</button>
      <button class="ghost sm" id="dmMgr">弹幕管理</button>
      <button class="ghost sm" id="fs">全屏</button>
    </div>
    <div id="rbody"><div id="stage"><img id="page" alt="漫画页面" draggable="false"><canvas id="dmv"></canvas><aside id="dmgr" hidden></aside></div></div>
    <div id="dmbox">
      <input id="dmt" maxlength="50" placeholder="说点什么…（回车发送）">
      <select id="dmp" class="sm"><option value="scroll">滚动</option><option value="top">顶部</option></select>
      ${["#ffffff", "#ffd400", "#3ddc97", "#7c5cff", "#ff5c8a", "#ff8a3d"].map((c, i) => `<span class="sw${i ? "" : " on"}" data-c="${c}" style="background:${c}" title="${c}"></span>`).join("")}
      <button id="dmsend" class="sm">发送</button>
    </div>
    <div id="rfoot"></div></div>`;
  $("#topbar").hidden = true;
  const exit = () => { $("#topbar").hidden = false; };

  const img = $("#page"), eng = new DM($("#dmv")), color = { v: "#ffffff" };
  let comic, chs = [], ci = 0, mgrOn = false;
  eng.start();

  $$(".sw", host).forEach(s => s.onclick = () => { $$(".sw", host).forEach(x => x.classList.remove("on")); s.classList.add("on"); color.v = s.dataset.c; });
  const foot = () => $("#rfoot").innerHTML = `<span>${esc(comic.title)} · ${esc(chs[ci]?.title || "第" + chs[ci]?.num + "话")}</span>
    <span class="pill">${esc(comic.license || LICENCES[0])}</span><span>${esc(comic.notice || "")}</span>
    <span class="spacer"></span><span>作者 ${esc(comic.authorName || "")}</span><span class="badge ${esc(comic.visibility)}">${VIS[comic.visibility] || ""}</span>`;
  const paintSel = () => { $("#rt").textContent = comic.title; $("#chSel").innerHTML = chs.map((h, i) => `<option value="${i}"${i === ci ? " selected" : ""}>第 ${h.num} 话 ${esc(h.title || "")}</option>`).join(""); };

  function schedule() { for (const d of G.dm.filter(x => x.page === G.page)) eng.spawn(d, Math.min(d.at || 0, 5000)); }

  let dmUnsub = null;
  async function mount() {
    if (dmUnsub) { try { dmUnsub(); } catch { } dmUnsub = null; }
    G.pages = chs[ci]?.pages || []; G.page = 0; G.dm = [];
    paintSel();
    if (!G.pages.length) { img.removeAttribute("src"); eng.reset(); $("#pg").textContent = "0 / 0"; foot(); return toast("本章还没有页面"); }
    let firstSnap = true;
    dmUnsub = onSnapshot(C.dm(comicId, chs[ci].cid), s => {
      G.dm = s.docs.map(d => ({ id: d.id, ...d.data() }));
      if (firstSnap) { firstSnap = false; eng.reset(); schedule(); }   // 首次按 at 重播
      else for (const ch of s.docChanges()) {                          // 之后只增量，避免别人一发弹幕全场重播
        const d = { id: ch.doc.id, ...ch.doc.data() };
        if (ch.type === "removed") eng.drop(d.id);
        else if (d.page === G.page) eng.spawn(d, 0);
      }
      paintMgr();
    }, e => toast("弹幕加载失败：" + (e.code || e.message)));
    show();
  }
  async function show() {
    if (!G.pages.length) return;
    const u = await getUrl(G.pages[G.page]);
    if (!u) { eng.reset(); return toast("图片读取被拒绝：你没有该作品的阅读权限"); }
    img.onload = () => { eng.resize(); eng.reset(); schedule(); };
    img.src = u;
    G.shownAt = now();
    $("#pg").textContent = `${G.page + 1} / ${G.pages.length}`;
    const j = $("#jump"); j.max = G.pages.length - 1; j.value = G.page;
    foot();
  }
  function next(k) {
    if (!G.pages.length) return;
    const p = G.page + k;
    if (p < 0) return goCh(-1);
    if (p >= G.pages.length) return goCh(1);
    G.page = p; show();
  }
  function goCh(k) { const t = ci + k; if (t < 0 || t >= chs.length) return toast(k > 0 ? "已经是最新话" : "已经是第一话"); ci = t; mount(); }
  async function send() {
    if (!G.uid) return guard();
    const text = $("#dmt").value.trim().slice(0, 50);
    if (!text) return;
    const d = { uid: G.uid, name: (G.me?.displayName || G.me?.handle || "匿名").slice(0, 20), text, page: G.page, pos: $("#dmp").value, color: color.v,
      at: Math.max(0, now() - G.shownAt), createdAt: serverTimestamp() };
    try { const r = await addDoc(C.dm(comicId, chs[ci].cid), d); $("#dmt").value = ""; eng.spawn({ id: r.id, ...d }, 0); }
    catch (e) { toast("发送失败：" + (e.message || e.code)); }
  }
  function paintMgr() {
    const box = $("#dmgr"); box.hidden = !mgrOn;
    if (!mgrOn) return;
    const list = G.dm.filter(d => d.page === G.page).slice(-80).reverse();
    const canDel = d => G.uid && (d.uid === G.uid || comic.ownerId === G.uid);
    box.innerHTML = `<b>本页弹幕 ${list.length}</b>${list.map(d => `<div class="row" style="gap:6px;border-bottom:1px solid #222839;padding:5px 0">
      <span style="flex:1;color:${esc(d.color || "#fff")};white-space:normal">${esc(d.text)}</span><span class="hint">${esc(String(d.name || "").slice(0, 8))}</span>
      ${canDel(d) ? `<button class="sm ghost" data-x="${esc(d.id)}">删</button>` : ""}</div>`).join("") || `<p class="hint">本页还没有弹幕</p>`}`;
    $$("[data-x]", box).forEach(b => b.onclick = async () => { try { await deleteDoc(C.dm(comicId, chs[ci].cid, b.dataset.x)); } catch { toast("没有删除权限"); } });
  }

  $("#back").onclick = () => location.hash = `#/comic/${comicId}`;
  $("#page").oncontextmenu = e => e.preventDefault();
  $("#rbody").onclick = e => { if (mgrOn && e.target.closest("#dmgr")) return; next(e.clientX > innerWidth * .35 ? 1 : -1); };
  $("#jump").oninput = e => { G.page = +e.target.value; show(); };
  $("#chSel").onchange = e => { ci = +e.target.value; mount(); };
  $("#dmOn").onclick = e => { G.danmakuOn = !G.danmakuOn; e.target.textContent = "弹幕：" + (G.danmakuOn ? "开" : "关"); };
  $("#dmMgr").onclick = () => { mgrOn = !mgrOn; paintMgr(); };
  $("#fs").onclick = () => document.fullscreenElement ? document.exitFullscreen() : $("#reader").requestFullscreen?.();
  $("#dmsend").onclick = send;
  $("#dmt").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); send(); } };
  const onKey = e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") next(1);
    else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") next(-1);
    else if (e.key === " ") { e.preventDefault(); next(1); }
    else if (e.key === "Escape") location.hash = `#/comic/${comicId}`;
  };
  const onResize = () => eng.resize();
  addEventListener("keydown", onKey); addEventListener("resize", onResize);
  G.unsubs.push(() => { removeEventListener("keydown", onKey); removeEventListener("resize", onResize); eng.stop(); exit(); });

  const cs = (await getDocs(C.chapters(comicId))).docs.map(d => ({ cid: d.id, ...d.data() })).sort((a, b) => a.num - b.num);
  const snap = await getDoc(C.comic(comicId));
  if (!snap.exists()) { host.innerHTML = `<div class="empty">作品不存在或无阅读权限。<a href="#/home">回到发现</a></div>`; exit(); return; }
  comic = { id: comicId, ...snap.data() }; chs = cs;
  ci = cid ? Math.max(0, cs.findIndex(x => x.cid === cid)) : 0;
  await mount();
}

/* ---------- 6. 创作台 ---------- */
async function viewStudio(v) {
  if (!guard()) return;
  const snap = await getDocs(query(C.comics(), where("ownerId", "==", G.uid), limit(200)));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  v.innerHTML = `<div class="row"><h2 style="flex:1">创作台</h2><button id="new">上传新漫画</button></div>
    <p class="hint" style="margin-bottom:14px">只有你本人能改自己的作品与图片 —— 这条限制写在服务端规则里，别人拿到你的 comicId 也写不动。</p>
    ${list.map(c => `<div class="card" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <div class="cov" data-cv="${esc(c.id)}" style="width:64px;height:86px;flex:none;border-radius:8px">${esc(c.title).slice(0, 3)}</div>
      <div style="flex:1;min-width:210px"><b>${esc(c.title)}</b> <span class="badge ${esc(c.visibility)}">${VIS[c.visibility]}</span>
        <div class="hint">${c.chapterCount || 0} 话 · ${esc(c.license || "")} · ${new Date(c.updatedAtMs || c.createdAtMs || 0).toLocaleString()}</div>
        <div class="hint">${esc((c.summary || "").slice(0, 70))}</div></div>
      <div class="row"><button class="sm" data-open="${esc(c.id)}">打开</button><button class="sm ghost" data-ed="${esc(c.id)}">编辑</button>
        <button class="sm ghost" data-up="${esc(c.id)}">加话</button><button class="sm danger" data-del="${esc(c.id)}">删除</button></div></div>`).join("")
      || `<div class="empty">你还没有作品，点右上角「上传新漫画」开始。</div>`}`;
  $("#new", v).onclick = () => comicForm();
  list.forEach(async c => paintCov($(`[data-cv="${c.id}"]`, v), await getUrl(c.coverPath)));
  $$("[data-open]", v).forEach(b => b.onclick = () => location.hash = "#/comic/" + b.dataset.open);
  $$("[data-ed]", v).forEach(b => b.onclick = () => comicForm(list.find(x => x.id === b.dataset.ed)));
  $$("[data-up]", v).forEach(b => b.onclick = () => chapterForm(list.find(x => x.id === b.dataset.up)));
  $$("[data-del]", v).forEach(b => b.onclick = async () => {
    const c = list.find(x => x.id === b.dataset.del);
    if (!confirm(`删除《${c.title}》的全部章节、页面与弹幕？`)) return;
    await deleteComic(c); toast("已删除"); viewStudio(v);
  });
}

async function comicForm(c) {
  const isNew = !c, fu = await myFriends();
  const d = dlg(`<h3>${isNew ? "上传新漫画" : "编辑《" + esc(c.title) + "》"}</h3>
    <form id="f" class="col">
      <div class="g2"><div class="col"><label>标题 *</label><input name="title" required maxlength="60" value="${esc(c?.title || "")}"></div>
        <div class="col"><label>作者署名</label><input name="authorName" maxlength="40" value="${esc(c?.authorName || G.me.displayName || "")}"></div></div>
      <div class="col"><label>简介</label><textarea name="summary" maxlength="600">${esc(c?.summary || "")}</textarea></div>
      <div class="col"><label>标签（逗号分隔，最多 8 个）</label><input name="tags" maxlength="120" value="${esc((c?.tags || []).join(", "))}"></div>
      <div class="g2"><div class="col"><label>可见性（服务端强制）</label><select name="visibility">${
        Object.entries(VIS).map(([k, n]) => `<option value="${k}"${c?.visibility === k ? " selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="col"><label>许可协议</label><select name="license">${LICENCES.map(l => `<option${c?.license === l ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div></div>
      <div class="col"><label>版权声明（显示在阅读页底部）</label><input name="notice" maxlength="160" value="${esc(c?.notice ?? "未经许可不得转载、复制或用于商业用途。")}"></div>
      ${isNew ? `<div class="col"><label>封面（可选）</label><input type="file" name="cover" accept="image/*"></div>
        <div class="g2"><div class="col"><label>第 1 话标题</label><input name="chtitle" maxlength="40" value="第 1 话"></div>
        <div class="col"><label>页面文件（多选，按文件名排序）</label><input type="file" name="pages" accept="image/*" multiple></div></div>` : ""}
      ${!isNew ? `<p class="hint">可见性改为「仅好友」时，会用当前好友名单（${fu.length} 人）作为快照；之后新加好友请重新保存作品。</p>` : ""}
      <div class="bar"><i></i></div><div class="err"></div>
      <div class="row"><button type="submit">${isNew ? "创建并上传" : "保存"}</button><button type="button" class="ghost" data-close>取消</button></div>
    </form>`);
  $("#f", d).onsubmit = async e => {
    e.preventDefault();
    const F = new FormData(e.target), err = $(".err", d), bar = $(".bar", d);
    err.textContent = "";
    const base = {
      title: String(F.get("title")).trim(), authorName: String(F.get("authorName") || "").trim() || G.me.displayName || G.me.handle,
      summary: String(F.get("summary") || "").trim(), tags: String(F.get("tags") || "").split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 8),
      visibility: F.get("visibility"), license: F.get("license"), notice: String(F.get("notice") || "").trim(),
      updatedAt: serverTimestamp(), updatedAtMs: now()
    };
    if (base.visibility === "friends") base.friendUids = fu;
    try {
      if (isNew) {
        const cref = await addDoc(C.comics(), { ...base, ownerId: G.uid, ownerHandle: G.me.handle, createdAt: serverTimestamp(), createdAtMs: now(), chapterCount: 0 });
        const id = cref.id;
        const cf = F.get("cover");
        let hasCover = false;
        if (cf && cf.size) { const p = `users/${G.uid}/covers/${id}.jpg`; await put(await shrink(cf), p, q => prog(bar, q * .25)); await updateDoc(cref, { coverPath: p }); hasCover = true; }
        const files = [...F.getAll("pages")].filter(f => f.size).sort((a, b) => a.name.localeCompare(b.name, "zh"));
        if (files.length) {
          const chId = await pushChapter(id, String(F.get("chtitle") || "第 1 话"), files, bar, .25);
          // 没单独传封面就拿第一话第一页顶上；「仅好友/仅自己」的作品封面本来也会被规则挡住，不会泄露内容
          if (!hasCover) await updateDoc(cref, { coverPath: `comics/${id}/chapters/${chId}/001.jpg` });
        }
        toast("已创建"); d.close(); d.remove(); location.hash = "#/comic/" + id;
      } else { await updateDoc(C.comic(c.id), base); toast("已保存"); d.close(); d.remove(); route(); }
    } catch (x) { err.textContent = "失败：" + (x.message || x.code || x); }
  };
}

async function chapterForm(c) {
  if (!c || !guard()) return;
  const d = dlg(`<h3>《${esc(c.title)}》上传新话</h3><form id="f" class="col">
    <div class="col"><label>话标题</label><input name="title" maxlength="40" value="第 ${(c.chapterCount || 0) + 1} 话"></div>
    <div class="col"><label>页面文件（多选，按文件名排序）</label><input type="file" name="pages" accept="image/*" multiple required></div>
    <div class="bar"><i></i></div><div class="err"></div>
    <div class="row"><button type="submit">上传</button><button type="button" class="ghost" data-close>取消</button></div></form>`);
  $("#f", d).onsubmit = async e => {
    e.preventDefault(); const F = new FormData(e.target);
    const files = [...F.getAll("pages")].filter(f => f.size).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    if (!files.length) return $(".err", d).textContent = "请选择图片文件";
    try { await pushChapter(c.id, String(F.get("title")), files, $(".bar", d), 0); toast(`已上传 ${files.length} 页`); d.close(); d.remove(); route(); }
    catch (x) { $(".err", d).textContent = "失败：" + (x.message || x.code || x); }
  };
}

/* 先传图片、成功后再落地章节文档，避免半途失败留下空话 */
async function pushChapter(comicId, title, files, bar, base = 0) {
  const cs = await getDocs(C.chapters(comicId));
  const num = Math.max(0, ...cs.docs.map(d => d.data().num || 0)) + 1;
  const cref = doc(D, "comics", comicId, "chapters", crypto.randomUUID ? crypto.randomUUID() : String(num) + "-" + now());
  const span = 1 - base;
  for (let i = 0; i < files.length; i++) {
    const blob = await shrink(files[i]);
    await put(blob, `comics/${comicId}/chapters/${cref.id}/${String(i + 1).padStart(3, "0")}.jpg`, q => prog(bar, base + span * ((i + q) / files.length)));
  }
  const pages = files.map((_, i) => `comics/${comicId}/chapters/${cref.id}/${String(i + 1).padStart(3, "0")}.jpg`);
  await setDoc(cref, { num, title: (title || "").trim() || `第 ${num} 话`, pages, pageCount: pages.length, ownerId: G.uid, createdAt: serverTimestamp(), createdAtMs: now() });
  await updateDoc(C.comic(comicId), { chapterCount: increment(1), updatedAt: serverTimestamp(), updatedAtMs: now() });
  prog(bar, 1);
  return cref.id;
}

async function delChapter(comicId, cid) {
  if (!confirm("删除这一话及其页面与弹幕？")) return;
  const ch = (await getDoc(C.chapter(comicId, cid))).data();
  await dropChapter(comicId, cid, ch.pages || []);
  await updateDoc(C.comic(comicId), { chapterCount: increment(-1), updatedAtMs: now() });
  toast("已删除本话");
}
async function dropChapter(comicId, cid, pages) {
  for (const p of pages) { try { await deleteObject(sref(St, p)); } catch { } }
  const ds = (await getDocs(C.dm(comicId, cid))).docs;
  for (let i = 0; i < ds.length; i += 400) {          // 单个 batch 上限 500 条写操作
    const b = writeBatch(D); ds.slice(i, i + 400).forEach(x => b.delete(x.ref));
    await b.commit();
  }
  await deleteDoc(C.chapter(comicId, cid));
}
async function deleteComic(c) {
  const cs = await getDocs(C.chapters(c.id));   // dropChapter 已连带删除章节文档
  for (const d of cs.docs) await dropChapter(c.id, d.id, d.data().pages || []).catch(() => { });
  if (c.coverPath) try { await deleteObject(sref(St, c.coverPath)); } catch { }
  await deleteDoc(C.comic(c.id));
}

/* ---------- 7. 好友 ---------- */
async function viewFriends(v) {
  if (!guard()) return;
  const s = await getDocs(query(C.frs(), where("members", "array-contains", G.uid), limit(400)));
  const rel = s.docs.map(d => ({ id: d.id, ...d.data() }));
  const other = r => r.members.find(u => u !== G.uid);
  const accepted = rel.filter(r => r.status === "accepted");
  const incoming = rel.filter(r => r.status === "pending" && r.from !== G.uid);
  const outgoing = rel.filter(r => r.status === "pending" && r.from === G.uid);
  const profs = new Map();
  await Promise.all([...new Set(rel.map(other).filter(Boolean))].map(async u => { const p = await getDoc(C.user(u)); if (p.exists()) profs.set(u, p.data()); }));
  const line = u => { const p = profs.get(u) || {}; const n = p.displayName || p.handle || u.slice(0, 8); return `<span class="avt">${esc(n.slice(0, 1).toUpperCase())}</span> ${esc(n)}`; };
  v.innerHTML = `<h2>好友</h2>
    <div class="card"><h3 style="margin-top:0">我的 handle：<b>${esc(G.me.handle)}</b></h3>
      <p class="hint">别人用这个 handle 就能找到你并申请加好友；它注册后不可修改，请谨慎对待。</p></div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">添加好友</h3>
      <div class="row"><input id="fq" placeholder="对方的 handle" style="flex:1;min-width:200px"><input id="fnote" placeholder="验证消息（可选）" maxlength="60" style="flex:1;min-width:160px"><button id="fgo">搜索并发送申请</button></div>
      <div id="fres" class="err" style="margin-top:10px"></div></div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">收到的申请（${incoming.length}）</h3>
      ${incoming.map(r => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">${line(other(r))}<span class="hint" style="flex:1">${esc(r.note || "")}</span>
        <button class="sm" data-ok="${esc(r.id)}">接受</button><button class="sm ghost" data-no="${esc(r.id)}">拒绝</button></div>`).join("") || `<p class="hint">暂无</p>`}</div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">我的好友（${accepted.length}）</h3>
      ${accepted.map(r => { const u = other(r), p = profs.get(u) || {}; return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">${line(u)}
        <span class="hint" style="flex:1">${esc(p.handle || "")}</span><button class="sm ghost" data-cut="${esc(r.id)}">解除</button></div>`; }).join("")
        || `<p class="hint">还没有好友。把作品可见性设为「仅好友」后，只有这里的人能读。</p>`}</div>
    ${outgoing.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">等待对方同意（${outgoing.length}）</h3>${
      outgoing.map(r => `<div class="row" style="padding:6px 0">${line(other(r))}<span class="spacer"></span><button class="sm ghost" data-cut="${esc(r.id)}">撤回</button></div>`).join("")}</div>` : ""}`;

  $("#fgo", v).onclick = async () => {
    const q = $("#fq", v).value.trim().toLowerCase(), box = $("#fres", v);
    if (!q) return box.textContent = "请输入对方的 handle";
    box.textContent = "查找中…";
    try {
      const s2 = await getDocs(query(C.users(), where("handle", "==", q), limit(5)));
      const hit = s2.docs.map(d => d.data()).find(u => u.uid !== G.uid);
      if (!hit) return box.textContent = s2.empty ? `没有 handle 为「${q}」的用户` : "这是你自己的账号";
      await sendRequest(hit.uid, $("#fnote", v).value);
      box.textContent = ""; viewFriends(v);
    } catch (e) { box.textContent = "失败：" + (e.message || e.code); }
  };
  $$("[data-ok]", v).forEach(b => b.onclick = async () => { await updateDoc(C.fr(b.dataset.ok), { status: "accepted", updatedAtMs: now() }); toast("已接受"); viewFriends(v); });
  $$("[data-no]", v).forEach(b => b.onclick = async () => { await updateDoc(C.fr(b.dataset.no), { status: "declined", updatedAtMs: now() }); viewFriends(v); });
  $$("[data-cut]", v).forEach(b => b.onclick = async () => {
    if (!confirm("解除好友关系？对方的「仅好友」作品将立刻对你不可见。")) return;
    await deleteDoc(C.fr(b.dataset.cut)); viewFriends(v);
  });
}
async function sendRequest(toUid, note) {
  const id = pairId(G.uid, toUid);
  const ex = await getDoc(C.fr(id));
  if (ex.exists() && ex.data().status === "accepted") return toast("你们已经是好友了");
  const patch = { status: "pending", from: G.uid, to: toUid, note: String(note || "").slice(0, 60), updatedAtMs: now() };
  if (ex.exists()) await updateDoc(C.fr(id), patch);   // 曾拒绝过 → 重新申请，走 update 规则
  else await setDoc(C.fr(id), { members: [G.uid, toUid].sort(), ...patch, createdAt: serverTimestamp() });
  toast("好友申请已发送");
}

/* ---------- 8. 登录 / 注册 ---------- */
function viewLogin(v) {
  if (G.uid) { location.hash = "#/home"; return; }
  v.innerHTML = `<div class="authwrap card"><h2>登录 / 注册</h2>
    <form id="f" class="col">
      <div class="col" id="nickWrap" hidden><label>昵称（注册用，会生成 handle）</label><input name="nick" maxlength="20" placeholder="例如 阿漫"></div>
      <div class="col"><label>邮箱</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="col"><label>密码（至少 6 位）</label><input name="pass" type="password" required minlength="6" autocomplete="current-password"></div>
      <div class="err" id="e"></div>
      <button type="submit" id="sub">登录</button>
      <button type="button" class="ghost" id="google">使用 Google 账号登录</button>
      <button type="button" class="ghost" id="swap">没有账号？注册</button></form>
    <p class="hint" style="margin-top:12px">注册后即可上传自己的漫画；作品默认「仅自己」可见，你可以随时改成公开或仅好友。</p></div>`;
  let mode = "in";
  const set = m => { mode = m; $("#nickWrap", v).hidden = m !== "up"; $("#sub", v).textContent = m === "up" ? "注册并登录" : "登录"; $("#swap", v).textContent = m === "up" ? "已有账号？登录" : "没有账号？注册"; };
  $("#swap", v).onclick = () => set(mode === "up" ? "in" : "up");
  $("#google", v).onclick = async () => {
    try { await Auth.signInWithPopup(A, new Auth.GoogleAuthProvider()); }
    catch (x) { $("#e", v).textContent = errText(x); }
  };
  $("#f", v).onsubmit = async e => {
    e.preventDefault();
    const F = new FormData(e.target), email = String(F.get("email")).trim(), pass = String(F.get("pass"));
    $("#e", v).textContent = "";
    try {
      if (mode === "up") { const cr = await Auth.createUserWithEmailAndPassword(A, email, pass); await profile(cr.user, String(F.get("nick") || "").trim()); }
      else await Auth.signInWithEmailAndPassword(A, email, pass);
      location.hash = G.route === "login" ? "#/home" : location.hash;
    } catch (x) { $("#e", v).textContent = errText(x); }
  };
}
const errText = x => ({ "auth/invalid-credential": "邮箱或密码不正确", "auth/wrong-password": "邮箱或密码不正确", "auth/user-not-found": "该邮箱还没有注册", "auth/email-already-in-use": "该邮箱已注册，直接登录即可", "auth/weak-password": "密码至少 6 位", "auth/popup-closed-by-user": "已取消 Google 登录", "auth/unauthorized-domain": "当前域名不在 Auth「授权域名」里，请用 localhost 或已备案域名打开", "auth/operation-not-allowed": "控制台里还没有开启对应的登录方式" }[x.code] || x.message || String(x));

/* 邮箱只留在 Auth，不写进 Firestore：任何登录用户都能读 users 文档（用于按 handle 找人） */
async function profile(u, nick) {
  const r = C.user(u.uid), ex = await getDoc(r);
  if (ex.exists()) return { uid: u.uid, ...ex.data() };
  const seed = (nick || String(u.email || "").split("@")[0] || u.uid).trim();
  const handle = await uniqueHandle(seed);
  const p = { uid: u.uid, displayName: seed.slice(0, 20), handle, createdAt: serverTimestamp(), createdAtMs: now() };
  await setDoc(r, p);
  return { uid: u.uid, ...p };
}
async function uniqueHandle(seed) {
  const base = String(seed).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 18) || "manga";
  for (const h of [base, ...Array.from({ length: 5 }, () => base + Math.floor(1000 + Math.random() * 9000))]) {
    const s = await getDocs(query(C.users(), where("handle", "==", h), limit(1)));
    if (s.empty) return h;
  }
  return base + Date.now().toString(36).slice(-6);
}

/* ---------- 9. 对话框 ---------- */
function dlg(html) {
  const d = document.createElement("dialog");
  d.innerHTML = html;
  document.body.appendChild(d);
  d.showModal();
  $("[data-close]", d).onclick = () => { d.close(); d.remove(); };
  d.addEventListener("close", () => setTimeout(() => d.remove(), 300), { once: true });
  return d;
}

/* ---------- 10. 启动 ---------- */
let booted = false;
$("#logo").onclick = () => location.hash = "#/home";
$("#btnAuth").onclick = async () => {
  if (!G.uid) return location.hash = "#/login";
  await Auth.signOut(A); location.hash = "#/home"; toast("已退出");
};
await new Promise(res => Auth.onAuthStateChanged(A, async u => {
  G.uid = u?.uid || null;
  G.me = u ? await profile(u, u.displayName || String(u.email || "").split("@")[0]) : null;
  paintHeader();
  if (booted) route();          // 登录态一变，当前页与顶栏都要跟着刷新
  else res();
}, res));
booted = true;
paintHeader();
addEventListener("hashchange", route);
route();
