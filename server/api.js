import {
  applyApiSecurityHeaders,
  assertAllowedOrigin,
  assertRateLimit,
  readJsonBody,
  sendJson
} from "./http.js";
import {
  connectionRequest,
  healthPayload,
  heritageNote,
  localEvents,
  smartPicks,
  storyMode,
  threadHosts
} from "./handlers.js";

const postRoutes = new Map([
  ["/api/context/smart-picks", { handler: smartPicks, status: 200 }],
  ["/api/place/heritage", { handler: heritageNote, status: 200 }],
  ["/api/place/story", { handler: storyMode, status: 200 }],
  ["/api/events", { handler: localEvents, status: 200 }],
  ["/api/threads/hosts", { handler: threadHosts, status: 200 }],
  ["/api/threads/request", { handler: connectionRequest, status: 201 }]
]);

export async function handleApiRequest(request, response) {
  applyApiSecurityHeaders(request, response);

  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    assertRateLimit(request);

    const route = new URL(request.url, "http://localhost").pathname;
    if (route === "/api/health" && request.method === "GET") {
      sendJson(response, 200, healthPayload());
      return;
    }

    const match = postRoutes.get(route);
    if (!match) {
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Endpoint not found" } });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this endpoint" } });
      return;
    }

    sendJson(response, match.status, await match.handler(await readJsonBody(request)));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("[api]", error.code || "REQUEST_FAILED", error.message);
    const status = error.status || 500;
    sendJson(response, status, {
      error: {
        code: error.code || "REQUEST_FAILED",
        message: status >= 500 ? "Request failed safely" : error.message
      }
    });
  }
}
