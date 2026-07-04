import { buildRuleReason, filterAndRankCandidates, hiddenGemScore } from "./decisionEngine.js";
import { saveConnectionRequest } from "./dataStore.js";
import { fetchEvents } from "./services/events.js";
import { askGemini, hasGemini } from "./services/gemini.js";
import { fetchPlaces, fetchThreadHosts, geocodeCity } from "./services/osm.js";
import { fetchWeather } from "./services/weather.js";
import { validateConnectionRequest, validateContext, validatePlaceContext } from "./validators.js";

export function healthPayload() {
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

export async function smartPicks(raw) {
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

export async function heritageNote(raw) {
  const input = validatePlaceContext(raw);
  const note = await askGemini({
    system: "Use only supplied facts. If facts are thin, state that details are unavailable. Never invent dates, people, legends, or claims.",
    prompt: `Place: ${JSON.stringify(input.place)}\nContext: ${JSON.stringify({ city: input.city, interests: input.interests })}\nWrite 3 concise heritage sentences.`,
    responseJson: false
  });
  return { note, source: "gemini", stamp: "heritage" };
}

export async function storyMode(raw) {
  const input = validatePlaceContext(raw);
  const transcript = await askGemini({
    system: "Create a grounded 150-word audio-guide transcript. Use only supplied place facts and clearly avoid unsupported historical claims.",
    prompt: `Place: ${JSON.stringify(input.place)}\nContext: ${JSON.stringify(input)}\nWrite a warm transcript.`,
    responseJson: false
  });
  return { transcript, source: "gemini", audioStatus: "transcript_only", stamp: "story" };
}

export async function localEvents(raw) {
  return { events: await fetchEvents(validateContext(raw)), stamp: "events", source: "ticketmaster" };
}

export async function threadHosts(raw) {
  const input = validateContext(raw);
  const city = await geocodeCity(input.city);
  return { hosts: await fetchThreadHosts(city), city, source: "openstreetmap" };
}

export async function connectionRequest(raw) {
  const receipt = await saveConnectionRequest(validateConnectionRequest(raw));
  return { ...receipt, stamp: "threads", source: "append-only-ledger" };
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
