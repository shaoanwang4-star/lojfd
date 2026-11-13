// 临时：把 index.html 换成 mock 版测试页
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
let h = readFileSync("index.html", "utf8");
h = h.replace(/apiKey: "PASTE_API_KEY"[\s\S]*?appId: "PASTE_APP_ID"/,
  'apiKey: "MOCK", authDomain: "mock.firebaseapp.com", projectId: "mock", storageBucket: "mock.appspot.com", messagingSenderId: "1", appId: "1:1:web:mock"');
const base = "https://www.gstatic.com/firebasejs/12.6.0/";
const map = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-storage.js"]
  .map(f => JSON.stringify(base + f) + ':"./mock.js"').join(",");
h = h.replace('<script type="module">', `<script type="importmap">{"imports":{${map}}}</script>\n<script type="module">`);
mkdirSync("_test", { recursive: true });
writeFileSync("_test/index.html", h);
console.log("built, config-mocked:", h.includes('"MOCK"'), "importmap:", h.includes("importmap"));
