// 临时静态服务器（仅用于本地验证）
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };
const root = process.cwd();
createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); res.end(await readFile(p)); }
  catch (e) { if (!res.headersSent) { res.writeHead(404); res.end("no " + e.code); } else res.end(); }
}).listen(8931, () => console.log("http://localhost:8931/_test/index.html"));
