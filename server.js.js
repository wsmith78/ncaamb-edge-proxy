// NCAAMB Edge — Odds API Proxy Server v4
// Deploys free to Render.com · node server.js

const https = require("https");
const http = require("http");

const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const UNDERDOG_TOKEN = process.env.UNDERDOG_TOKEN || "";
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

// Fetch from Underdog API with Bearer token
function underdogFetch(path, callback) {
  const options = {
    hostname: "api.underdogfantasy.com",
    path: path,
    method: "GET",
    headers: {
      "Authorization": `Bearer ${UNDERDOG_TOKEN}`,
      "Content-Type": "application/json",
      "X-Underdog-Platform": "web",
    }
  };
  const req = https.request(options, (apiRes) => {
    let body = "";
    apiRes.on("data", chunk => body += chunk);
    apiRes.on("end", () => {
      try {
        callback(null, apiRes.statusCode, JSON.parse(body));
      } catch (e) {
        callback(null, apiRes.statusCode, { raw: body });
      }
    });
  });
  req.on("error", err => callback(err, null, null));
  req.end();
}

// Parse Underdog raw response into normalized game list
function parseUnderdogGames(data) {
  const games       = data.games || [];
  const lines       = data.over_under_lines || [];
  const appearances = data.appearances || [];

  const gameMap = {};
  games.forEach(g => { gameMap[g.id] = g; });

  const appByGame = {};
  appearances.forEach(a => {
    const gid = a.match_id || a.game_id || a.id;
    if (!appByGame[gid]) appByGame[gid] = [];
    appByGame[gid].push(a);
  });

  const result = [];

  // Method 1 — games array
  games.forEach(g => {
    const entry = {
      id: g.id,
      homeTeam: g.home_team_name || g.home_team || "",
      awayTeam: g.away_team_name || g.away_team || "",
      startTime: g.scheduled_at || g.start_time || "",
      homeSpread:     g.home_spread  != null ? g.home_spread  : (g.spread != null ? g.spread : null),
      awaySpread:     g.away_spread  != null ? g.away_spread  : (g.home_spread != null ? -g.home_spread : null),
      homeML:         g.home_ml      || g.home_money_line || null,
      awayML:         g.away_ml      || g.away_money_line || null,
      homeSpreadOdds: g.home_spread_odds || -110,
      awaySpreadOdds: g.away_spread_odds || -110,
      total:          g.total || g.over_under || null,
      source: "games",
    };
    if (entry.homeTeam || entry.awayTeam) result.push(entry);
  });

  // Method 2 — over_under_lines fallback
  if (result.length === 0 && lines.length > 0) {
    const seen = new Set();
    lines.forEach(l => {
      const gid = l.match_id || l.game_id;
      if (!gid || seen.has(gid)) return;
      seen.add(gid);
      const g = gameMap[gid] || {};
      const apList = appByGame[gid] || [];
      const homeApp = apList.find(a => a.home_or_away === "home") || apList[0] || {};
      const awayApp = apList.find(a => a.home_or_away === "away") || apList[1] || {};
      result.push({
        id: gid,
        homeTeam: g.home_team_name || homeApp.team_name || homeApp.name || "",
        awayTeam: g.away_team_name || awayApp.team_name || awayApp.name || "",
        startTime: g.scheduled_at || l.start_time || "",
        homeSpread:     l.home_line != null ? l.home_line : (l.spread != null ? l.spread : null),
        awaySpread:     l.away_line != null ? l.away_line : (l.home_line != null ? -l.home_line : null),
        homeML: null,
        awayML: null,
        homeSpreadOdds: l.home_odds || -110,
        awaySpreadOdds: l.away_odds || -110,
        total: l.stat_value || null,
        source: "lines",
      });
    });
  }

  return result;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path = parsed.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Root — status page
  if (path === "/" || path === "") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      service: "NCAAMB Edge Proxy",
      version: "v4",
      hasApiKey: !!ODDS_API_KEY,
      hasUnderdogToken: !!UNDERDOG_TOKEN,
      message: ODDS_API_KEY ? "Proxy is live." : "ERROR: ODDS_API_KEY env var is missing.",
      testUrl: "/odds/sports/basketball_ncaab/odds/?regions=us&markets=spreads&bookmakers=draftkings&oddsFormat=american",
      underdogUrl: "/underdog/cbb/debug"
    }));
    return;
  }

  // Health check
  if (path === "/health") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      hasApiKey: !!ODDS_API_KEY,
      hasUnderdogToken: !!UNDERDOG_TOKEN
    }));
    return;
  }

  // ── UNDERDOG CBB — live games with spreads + odds ──────────────────────────
  if (req.method === "GET" && path === "/underdog/cbb") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    if (!UNDERDOG_TOKEN) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "UNDERDOG_TOKEN not set on Render. Add it as an environment variable." }));
      return;
    }
    underdogFetch("/v2/over_under_lines?sport_id=CBB", (err, status, data) => {
      if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
      if (status === 401) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "Token expired — refresh UNDERDOG_TOKEN in Render dashboard." }));
        return;
      }
      if (status !== 200) {
        res.writeHead(status);
        res.end(JSON.stringify({ error: `Underdog API returned ${status}`, raw: data }));
        return;
      }
      const games = parseUnderdogGames(data);
      res.writeHead(200);
      res.end(JSON.stringify({ source: "underdog", count: games.length, games }));
    });
    return;
  }

  // ── UNDERDOG DEBUG — raw response for structure inspection ─────────────────
  if (req.method === "GET" && path === "/underdog/cbb/debug") {
    setCORS(res);
    res.setHeader("Content-Type", "application/json");
    if (!UNDERDOG_TOKEN) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "UNDERDOG_TOKEN not set on Render." }));
      return;
    }
    underdogFetch("/v2/over_under_lines?sport_id=CBB", (err, status, data) => {
      if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
      const sample = {};
      Object.entries(data).forEach(([k, v]) => {
        sample[k] = Array.isArray(v) ? v.slice(0, 3) : v;
      });
      res.writeHead(status);
      res.end(JSON.stringify({ httpStatus: status, keys: Object.keys(data), sample }));
    });
    return;
  }

  // ── ODDS PROXY ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && path.startsWith("/odds/")) {
    if (!ODDS_API_KEY) {
      setCORS(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(500);
      res.end(JSON.stringify({ error: "ODDS_API_KEY not set. Add it as an environment variable in Render dashboard." }));
      return;
    }
    const pathParts = path.replace(/^\/odds\//, "");
    parsed.searchParams.set("apiKey", ODDS_API_KEY);
    const queryString = parsed.searchParams.toString().replace(/%2C/g, ",");
    const targetUrl = `https://api.the-odds-api.com/v4/${pathParts}?${queryString}`;
    console.log(`[${new Date().toISOString()}] → ${pathParts}`);
    proxyRequest(targetUrl, res);
    return;
  }

  // 404
  setCORS(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found. Visit / for status." }));
});

server.listen(PORT, () => {
  console.log(`NCAAMB Edge Proxy v4 on port ${PORT}`);
  console.log(`Odds API Key:   ${ODDS_API_KEY   ? "✓ Set" : "✗ MISSING"}`);
  console.log(`Underdog Token: ${UNDERDOG_TOKEN ? "✓ Set" : "✗ Not set (optional — add later)"}`);
});
