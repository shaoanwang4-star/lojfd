// 临时测试替身：模拟 Firebase 的 app/auth/firestore/storage 四个入口，只用于本地验证 UI 与弹幕。
const DB = new Map();          // path -> data
const OBJS = new Map();        // storage path -> objectURL
const LISTENERS = [];          // {prefix, cb}
const authCbs = [];
let currentUser = null;

const fire = path => LISTENERS.filter(l => path.startsWith(l.prefix)).forEach(l => l.cb());
const segs = p => p.split("/");

export function initializeApp() { return { name: "test" }; }
export const getFirestore = () => ({});
export const getStorage = () => ({});
export class GoogleAuthProvider { }
export const getAuth = () => ({});
export function onAuthStateChanged(a, next) { authCbs.push(next); next(currentUser); return () => { }; }
const mkUser = (email, nick) => ({ uid: "u-" + email, email, displayName: nick || "" });
export async function createUserWithEmailAndPassword(a, email) { currentUser = mkUser(email); authCbs.forEach(f => f(currentUser)); return { user: currentUser }; }
export async function signInWithEmailAndPassword(a, email) { currentUser = mkUser(email); authCbs.forEach(f => f(currentUser)); return { user: currentUser }; }
export async function signInWithPopup() { currentUser = mkUser("gmail.user", "Google 用户"); authCbs.forEach(f => f(currentUser)); return { user: currentUser }; }
export async function signOut() { currentUser = null; authCbs.forEach(f => f(null)); }
export function __login(email) { currentUser = mkUser(email); authCbs.forEach(f => f(currentUser)); }
export function __logout() { currentUser = null; authCbs.forEach(f => f(null)); }

export const serverTimestamp = () => ({ __ts: true });
export const increment = n => ({ __inc: n });
const settle = (v, old) => (v && v.__ts ? Date.now() : v && v.__inc ? (old || 0) + v.__inc : v);

export const doc = (d, ...p) => ({ path: p.join("/"), id: segs(p.join("/")).pop() });
export const collection = (d, ...p) => ({ path: p.join("/"), id: segs(p.join("/")).pop() });
export const query = (c, ...opts) => ({ path: c.path, filters: opts.filter(o => o.__w), limit: (opts.find(o => o.__l) || {}).n });
export const where = (f, op, v) => ({ __w: { f, op, v } });
export const limit = n => ({ __l: true, n });

const members = prefix => [...DB.entries()].filter(([p]) => p.startsWith(prefix + "/") && !segs(p).slice(segs(prefix).length + 1).length);
export async function getDoc(r) {
  const hit = [...DB.entries()].find(([p]) => p === r.path || p.startsWith(r.path + "/"));
  if (!DB.has(r.path)) return { exists: () => false, id: r.id, data: () => undefined, ref: r };
  return { exists: () => true, id: r.id, data: () => DB.get(r.path), ref: r };
}
export async function getDocs(q) {
  const path = q.path || q.path === "" ? q.path : q.path;
  let rows = members(path);
  for (const flt of (q.filters || [])) {
    const { f, op, v } = flt.__w;
    rows = rows.filter(([, d]) => op === "==" ? d[f] === v : Array.isArray(d[f]) && d[f].includes(v));
  }
  if (q.limit) rows = rows.slice(0, q.limit);
  const docs = rows.map(([p, d]) => ({ id: segs(p).pop(), path: p, exists: () => true, data: () => d, ref: doc(null, p) }));
  return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
}
export async function setDoc(r, data) {
  DB.set(r.path, JSON.parse(JSON.stringify({ ...DB.get(r.path), ...data })));
  fire(r.path); return null;
}
export async function updateDoc(r, patch) {
  const old = DB.get(r.path) || {};
  const next = { ...old };
  for (const k in patch) next[k] = settle(patch[k], old[k]);
  DB.set(r.path, next); fire(r.path);
}
export async function deleteDoc(r) { DB.delete(r.path); fire(r.path); }
export async function addDoc(c, data) {
  const id = "id" + Math.random().toString(36).slice(2, 9);
  DB.set(c.path + "/" + id, JSON.parse(JSON.stringify(data), (k, v) => (v && v.__ts ? Date.now() : v)));
  fire(c.path + "/" + id);
  return { id, path: c.path + "/" + id };
}
export function onSnapshot(c, cb, err) {
  let prev = new Map();
  const l = {
    prefix: c.path, cb: () => {
      const rows = members(c.path).map(([p, d]) => ({ id: segs(p).pop(), data: () => d, ref: doc(null, p) }));
      const cur = new Map(rows.map(r => [r.id, r]));
      const changes = [];
      for (const [id, r] of cur) if (!prev.has(id)) changes.push({ type: "added", doc: r });
      for (const id of prev.keys()) if (!cur.has(id)) changes.push({ type: "removed", doc: { id, data: () => ({}) } });
      prev = cur;
      cb({ docs: rows, size: rows.length, empty: !rows.length, forEach: f => rows.forEach(f), docChanges: () => changes });
    }
  };
  LISTENERS.push(l); setTimeout(l.cb, 0);
  return () => { const i = LISTENERS.indexOf(l); if (i >= 0) LISTENERS.splice(i, 1); };
}
export function writeBatch(d) {
  const ops = [];
  return { delete: r => ops.push(r), commit: async () => { ops.forEach(deleteDoc); } };
}

export const ref = (s, path) => ({ path });
export function uploadBytesResumable(r, blob, opts) {
  return { on: (_ev, next, err, done) => setTimeout(() => { next({ bytesTransferred: 1, totalBytes: 1 }); OBJS.set(r.path, URL.createObjectURL(blob)); done(); }, 20) };
}
export async function getDownloadURL(r) { return OBJS.get(r.path) || ""; }
export async function deleteObject(r) { OBJS.delete(r.path); }
export const __db = DB;
