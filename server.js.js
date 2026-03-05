// NCAAMB Edge — Odds API Proxy Server v2
// Deploys free to Render.com · node server.js

const https = require("https");
const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function proxyRequest(targetUrl, res) {
  https.get(targetUrl, (apiRes) => {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    const remaining = apiRes.headers["x-requests-remaining"];
    const used = apiRes.headers["x-requests-used"];
    if (remaining) res.setHeader("x-requests-remaining", remaining);
    if (used) res.setHeader("x-requests-used", used);
    res.writeHead(apiRes.statusCode);
    apiRes.pipe(res);
  }).on("error", (err) => {
    setCORS(res);
    res.writeHead(502);
    res.end(JSON.stringify({ error: "Upstream error: " + err.message }));
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Root — status page (visit this to confirm proxy is alive)
  if (path === "/" || path === "") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      service: "NCAAMB Edge Proxy",
      hasApiKey: !!ODDS_API_KEY,
      message: ODDS_API_KEY
        ? "Proxy is live. API key is set."
        : "ERROR: ODDS_API_KEY env var is missing. Set it in Render dashboard.",
      testUrl: "/odds/sports/basketball_ncaab/odds/?regions=us&markets=spreads&bookmakers=draftkings&oddsFormat=american"
    }));
    return;
  }

  // Health check
  if (path === "/health") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", hasApiKey: !!ODDS_API_KEY }));
    return;
  }

  // Odds proxy — must start with /odds/
  if (req.method === "GET" && path.startsWith("/odds/")) {
    if (!ODDS_API_KEY) {
      setCORS(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(500);
      res.end(JSON.stringify({
        error: "ODDS_API_KEY not set. Add it as an environment variable in Render dashboard."
      }));
      return;
    }

    // Strip /odds/ prefix, forward to the-odds-api.com/v4/
    const pathParts = path.replace(/^\/odds\//, "");
    const queryParams = { ...parsed.query, apiKey: ODDS_API_KEY };
    const queryString = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const targetUrl = `https://api.the-odds-api.com/v4/${pathParts}?${queryString}`;
    console.log(`[${new Date().toISOString()}] → ${pathParts}`);
    proxyRequest(targetUrl, res);
    return;
  }

  // Everything else → 404
  setCORS(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found. Visit / for status." }));
});

server.listen(PORT, () => {
  console.log(`NCAAMB Edge Proxy v2 on port ${PORT}`);
  console.log(`API Key: ${ODDS_API_KEY ? "✓ Set" : "✗ MISSING — set ODDS_API_KEY in Render"}`);
});
