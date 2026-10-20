// Servidor local simples para abrir o site no navegador: node servidor.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORTA = 8080;
const TIPOS = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };

http.createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const arq = path.join(__dirname, caminho === "/" ? "index.html" : caminho);
  if (!arq.startsWith(__dirname) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404).end("Não encontrado");
    return;
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] ?? "application/octet-stream" });
  fs.createReadStream(arq).pipe(res);
}).listen(PORTA, () => console.log(`Abra http://localhost:${PORTA} no navegador (Ctrl+C para parar).`));
