import { $, escapeHtml, renderStatus, sectionHead, view } from "../dom.js";
import { postJson } from "../apiClient.js";
import { awardStamp, state } from "../state.js";

export function renderDetail() {
  const place = state.selectedPlace;
  if (!place) {
    renderStatus("Select a place first.", "bad");
    return;
  }
  view.innerHTML = sectionHead(place.name, `${place.category} · ${(place.distanceKm || 0).toFixed(1)} km`) +
    `<div class="detail">
      <article class="card card-body">
        <p>${escapeHtml(place.address || "Address unavailable in OpenStreetMap data")}</p>
        <pre>${escapeHtml(JSON.stringify(place.tags || {}, null, 2).slice(0, 700))}</pre>
      </article>
      <article class="card card-body">
        <div class="actions">
          <button id="heritage">Heritage Note</button>
          <button id="story">Story Mode</button>
        </div>
        <div id="generated" class="status" role="status">Choose a generated mode. Transcript text appears here for accessibility.</div>
      </article>
    </div>`;
  $("heritage").addEventListener("click", () => loadGenerated("heritage"));
  $("story").addEventListener("click", () => loadGenerated("story"));
}

async function loadGenerated(kind) {
  $("generated").className = "status";
  $("generated").textContent = "Calling Gemini with selected place facts.";
  try {
    const data = await postJson(`/api/place/${kind}`, { ...state.context, place: state.selectedPlace });
    awardStamp(data.stamp);
    $("generated").textContent = data.note || data.transcript;
  } catch (error) {
    $("generated").className = "status bad";
    $("generated").setAttribute("role", "alert");
    $("generated").textContent = error.message;
  }
}
