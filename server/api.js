import { buildRuleReason, filterAndRankCandidates, hiddenGemScore } from "./decisionEngine.js";
import { saveConnectionRequest } from "./dataStore.js";
import { fetchEvents } from "./services/events.js";
import { askGemini, hasGemini } from "./services/gemini.js";
import { fetchPlaces, fetchThreadHosts, geocodeCity } from "./services/osm.js";
import { fetchWeather } from "./services/weather.js";
import { validateConnectionRequest, validateContext, validatePlaceContext } from "./validators.js";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 80;
const rateBuckets = new Map();

export async function handleApiRequest(request, response) {
  applySecurityHeaders(request, response);

  try {
    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(response, 403, { error: { code: "FORBIDDEN_ORIGIN", message: "Origin is not allowed" } });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!allowRequest(request)) {
      sendJson(response, 429, { error: { code: "RATE_LIMITED", message: "Too many requests" } });
      return;
    }

    const route = new URL(request.url, "http://localhost").pathname;
    if (route === "/api/health" && request.method === "GET") {
      sendJson(response, 200, healthPayload());
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this endpoint" } });
      return;
    }

    const body = await readJsonBody(request);
    if (route === "/api/context/smart-picks") {
      sendJson(response, 200, await smartPicks(body));
      return;
    }
    if (route === "/api/place/heritage") {
      sendJson(response, 200, await heritageNote(body));
      return;
    }
    if (route === "/api/place/story") {
      sendJson(response, 200, await storyMode(body));
      return;
    }
    if (route === "/api/events") {
      sendJson(response, 200, { events: await fetchEvents(validateContext(body)), stamp: "events", source: "ticketmaster" });
      return;
    }
    if (route === "/api/threads/hosts") {
      const input = validateContext(body);
      const city = await geocodeCity(input.city);
      sendJson(response, 200, { hosts: await fetchThreadHosts(city), city, source: "openstreetmap" });
      return;
    }
    if (route === "/api/threads/request") {
      const receipt = await saveConnectionRequest(validateConnectionRequest(body));
      sendJson(response, 201, { ...receipt, stamp: "threads", source: "append-only-ledger" });
      return;
    }

    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Endpoint not found" } });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[api]", error.code || "REQUEST_FAILED", error.message);
    }
    const status = error.status || 500;
    sendJson(response, status, {
      error: {
        code: error.code || "REQUEST_FAILED",
        message: status >= 500 ? "Request failed safely" : error.message
      }
    });
  }
}

function healthPayload() {
  return {
    ok: true,
    services: {
      places: "openstreetmap",
      weather: "open-meteo",
      gemini: hasGemini() ? "configured" : "not_configured",
      events: process.env.EVENTS_API_KEY ? "configured" : "not_configured",
      requests: process.env.VERCEL ? "ephemeral_append_only_ledger" : "local_append_only_ledger"
    }
  };
}

async function smartPicks(raw) {
  const context = validateContext(raw);
  const city = await geocodeCity(context.city);
  const [places, weather] = await Promise.all([fetchPlaces(city), fetchWeather(city)]);
  const contextWithTime = {
    ...context,
    timeOfDay: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
  };
  const ranked = filterAndRankCandidates({ places, context: contextWithTime, weather });
  const ai = await tryRankWithGemini({ ranked, context: contextWithTime, weather });
  const picks = ranked.slice(0, 5).map((place, index) => ({
    ...place,
    reason: ai.ranking?.[place.id] || buildRuleReason(place, contextWithTime, weather),
    reasonSource: ai.ranking?.[place.id] ? "gemini" : "rule-layer",
    rank: index + 1
  }));
  const hiddenGems = ranked
    .map((place) => ({ ...place, hiddenGemScore: hiddenGemScore(place) }))
    .sort((a, b) => b.hiddenGemScore - a.hiddenGemScore)
    .slice(0, 4)
    .map((place) => ({
      ...place,
      reason: `Lower-visibility ${place.category} pick from live OpenStreetMap data, selected for fit and proximity.`
    }));

  return {
    city,
    weather,
    context: contextWithTime,
    picks,
    hiddenGems,
    aiStatus: ai.status,
    sources: ["Nominatim", "Overpass", "Open-Meteo", ai.status === "ok" ? "Gemini" : null].filter(Boolean)
  };
}

async function heritageNote(raw) {
  const input = validatePlaceContext(raw);
  const note = await askGemini({
    system: "Use only supplied facts. If facts are thin, state that details are unavailable. Never invent dates, people, legends, or claims.",
    prompt: `Place: ${JSON.stringify(input.place)}\nContext: ${JSON.stringify({ city: input.city, interests: input.interests })}\nWrite 3 concise heritage sentences.`,
    responseJson: false
  });
  return { note, source: "gemini", stamp: "heritage" };
}

async function storyMode(raw) {
  const input = validatePlaceContext(raw);
  const transcript = await askGemini({
    system: "Create a grounded 150-word audio-guide transcript. Use only supplied place facts and clearly avoid unsupported historical claims.",
    prompt: `Place: ${JSON.stringify(input.place)}\nContext: ${JSON.stringify(input)}\nWrite a warm transcript.`,
    responseJson: false
  });
  return { transcript, source: "gemini", audioStatus: "transcript_only", stamp: "story" };
}

async function tryRankWithGemini({ ranked, context, weather }) {
  if (!hasGemini()) return { status: "not_configured", ranking: null };
  try {
    const text = await askGemini({
      system: "Return JSON mapping each supplied id to one grounded sentence. Use only supplied JSON facts.",
      prompt: JSON.stringify({ context, weather, candidates: ranked.slice(0, 8) }),
      responseJson: true
    });
    return { status: "ok", ranking: JSON.parse(text) };
  } catch {
    return { status: "failed", ranking: null };
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large");
        error.status = 413;
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.status = 400;
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function applySecurityHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin)) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "origin");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const configured = (process.env.FRONTEND_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "http:" && hostname === "localhost" || protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function allowRequest(request) {
  const ip = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}
