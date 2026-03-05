// NCAAMB Edge — Odds API Proxy Server
// Deploys free to Render.com or Railway.app
// Fixes CORS so your iPhone can call the Odds API directly

const https = require("https");
const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // set to your claude.site URL for security

// ─── CORS HEADERS ────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ─── PROXY REQUEST ────────────────────────────────────────────────────────────
function proxyRequest(targetUrl, res) {
  https.get(targetUrl, (apiRes) => {
    const remaining = apiRes.headers["x-requests-remaining"];
    const used = apiRes.headers["x-requests-used"];

    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    if (remaining) res.setHeader("x-requests-remaining", remaining);
    if (used) res.setHeader("x-requests-used", used);
    res.writeHead(apiRes.statusCode);
    apiRes.pipe(res);
  }).on("error", (err) => {
    setCORS(res);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Health check
  if (parsed.pathname === "/health") {
    setCORS(res);
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", hasKey: !!ODDS_API_KEY }));
    return;
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Only allow GET to /odds/*
  if (req.method !== "GET" || !parsed.pathname.startsWith("/odds")) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (!ODDS_API_KEY) {
    setCORS(res);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "ODDS_API_KEY not set in environment variables" }));
    return;
  }

  // Build Odds API URL from query params
  // Expected: /odds/sports/{sport}/odds/?regions=us&markets=h2h,spreads,totals&bookmakers=...
  const pathParts = parsed.pathname.replace("/odds/", "");
  const queryParams = { ...parsed.query, apiKey: ODDS_API_KEY };
  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const targetUrl = `https://api.the-odds-api.com/v4/${pathParts}?${queryString}`;

  console.log(`[${new Date().toISOString()}] Proxying: ${pathParts}`);
  proxyRequest(targetUrl, res);
});

server.listen(PORT, () => {
  console.log(`NCAAMB Edge Proxy running on port ${PORT}`);
  console.log(`API Key: ${ODDS_API_KEY ? "✓ Set" : "✗ Missing — set ODDS_API_KEY env var"}`);
});
