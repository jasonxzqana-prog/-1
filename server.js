const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { buildDashboardData, listDailyFiles } = require("./src/data");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendStatic(res, pathname) {
  const relativePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

function handleApi(req, res, url) {
  const action = url.searchParams.get("action") || url.pathname.replace(/^\/api\/?/, "");

  if (action === "files") {
    sendJson(res, 200, { files: listDailyFiles(ROOT) });
    return;
  }

  if (action === "data") {
    try {
      const data = buildDashboardData(ROOT, {
        fileId: url.searchParams.get("file") || undefined,
        month: url.searchParams.get("month") || undefined
      });
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "读取数据失败"
      });
    }
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  sendStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`主播数据看板已启动: http://localhost:${PORT}`);
});
