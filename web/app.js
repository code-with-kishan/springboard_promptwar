const INTERESTS = [
  ["food", "Food"],
  ["heritage", "History"],
  ["art", "Art"],
  ["nature", "Nature"],
  ["nightlife", "Nightlife"],
  ["craft", "Craft"]
];

const state = {
  context: null,
  data: null,
  selectedPlace: null,
  activeTab: "smart",
  recentCategoriesShown: [],
  passport: new Set(),
  panel: null,
  events: null,
  hosts: null
};

const $ = (id) => document.getElementById(id);
const view = $("view");
const form = $("setupForm");
const tripTotal = $("tripDaysTotal");
const tripDay = $("tripDay");

init();

function init() {
  renderInterestChips(new Set(["food", "heritage", "art"]));
  syncRangeText();
  tripTotal.addEventListener("input", () => {
    tripDay.max = tripTotal.value;
    if (Number(tripDay.value) > Number(tripTotal.value)) tripDay.value = tripTotal.value;
    syncRangeText();
  });
  tripDay.addEventListener("input", syncRangeText);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadSmartPicks(readContext());
  });
  document.querySelector(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    setTab(button.dataset.tab);
  });
  renderEmpty();
}

function renderInterestChips(selected) {
  $("interests").replaceChildren(...INTERESTS.map(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.value = value;
    button.setAttribute("aria-pressed", selected.has(value) ? "true" : "false");
    button.addEventListener("click", () => {
      const next = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(next));
    });
    return button;
  }));
}

function syncRangeText() {
  $("tripLengthText").textContent = `${tripTotal.value} days`;
  $("tripDayText").textContent = tripDay.value;
}

function readContext() {
  const interests = [...document.querySelectorAll("#interests button[aria-pressed='true']")].map((button) => button.dataset.value);
  return {
    city: $("city").value,
    tripDay: Number(tripDay.value),
    tripDaysTotal: Number(tripTotal.value),
    interests,
    budget: $("budget").value,
    recentCategoriesShown: state.recentCategoriesShown
  };
}

async function loadSmartPicks(context) {
  state.context = context;
  renderStatus("Building live context from weather and local place data.");
  try {
    const data = await api("/api/context/smart-picks", context);
    state.data = data;
    state.selectedPlace = data.picks[0] || null;
    state.passport.add("smart");
    if (data.hiddenGems.length) state.passport.add("hidden");
    renderContext(data);
    setTab("smart");
  } catch (error) {
    renderStatus(error.message, "bad");
  }
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  if (!state.data) {
    renderEmpty();
    return;
  }
  if (tab === "smart") renderSmart();
  if (tab === "hidden") renderHidden();
  if (tab === "detail") renderDetail();
  if (tab === "events") renderEvents();
  if (tab === "threads") renderThreads();
  if (tab === "passport") renderPassport();
}

function renderContext(data) {
  const delta = 0.035;
  const { lat, lng } = data.city;
  $("contextPanel").innerHTML = `
    <strong>${escapeHtml(data.city.city)}</strong>
    <span>${escapeHtml(data.weather.label)}, ${Math.round(data.weather.temperatureC)} C</span>
    <span>Day ${data.context.tripDay} of ${data.context.tripDaysTotal} · ${escapeHtml(data.context.timeOfDay)}</span>
    <iframe class="map-frame" title="OpenStreetMap view of ${escapeHtml(data.city.city)}" loading="lazy"
      src="https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lng}"></iframe>
    <small>Sources: ${data.sources.map(escapeHtml).join(", ")} · Gemini ${escapeHtml(data.aiStatus.replace("_", " "))}</small>
  `;
}

function renderSmart() {
  view.innerHTML = sectionHead("Smart Picks", "Live OSM places ranked through the deterministic context engine.", "<button class='ghost' id='refresh'>Refresh</button>") +
    `<div class="grid">${state.data.picks.map(placeCard).join("")}</div>`;
  $("refresh").addEventListener("click", () => loadSmartPicks(state.context));
  bindPlaceActions();
}

function placeCard(place) {
  return `
    <article class="card">
      <div class="visual"><strong>${escapeHtml(place.category)}</strong><span>${place.distanceKm.toFixed(1)} km</span></div>
      <div class="card-body">
        <p class="eyebrow">Rank ${place.rank}</p>
        <h2>${escapeHtml(place.name)}</h2>
        <p>${escapeHtml(place.reason)}</p>
        <small>Reason source: ${escapeHtml(place.reasonSource)}</small>
        <div class="actions">
          <button data-action="skip" data-id="${escapeHtml(place.id)}">Skip</button>
          <button data-action="save" data-id="${escapeHtml(place.id)}">Save</button>
        </div>
      </div>
    </article>`;
}

function bindPlaceActions() {
  view.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const place = state.data.picks.find((item) => item.id === button.dataset.id);
      if (!place) return;
      state.recentCategoriesShown = [...state.recentCategoriesShown, place.category].slice(-8);
      if (button.dataset.action === "save") state.selectedPlace = place;
      loadSmartPicks({ ...state.context, recentCategoriesShown: state.recentCategoriesShown });
    });
  });
}

function renderHidden() {
  view.innerHTML = sectionHead("Off the Path", "Lower-visibility places from the same live result set.") +
    `<div class="grid">${state.data.hiddenGems.map((place) => `
      <button class="card card-body" data-id="${escapeHtml(place.id)}">
        <span class="eyebrow">${escapeHtml(place.category)}</span>
        <strong>${escapeHtml(place.name)}</strong>
        <small>${escapeHtml(place.reason)}</small>
      </button>`).join("")}</div>`;
  view.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPlace = state.data.hiddenGems.find((item) => item.id === button.dataset.id);
      setTab("detail");
    });
  });
}

function renderDetail() {
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
        <div id="generated" class="status">Choose a generated mode. Transcript text appears here for accessibility.</div>
      </article>
    </div>`;
  $("heritage").addEventListener("click", () => loadGenerated("heritage"));
  $("story").addEventListener("click", () => loadGenerated("story"));
}

async function loadGenerated(kind) {
  $("generated").textContent = "Calling Gemini with selected place facts.";
  try {
    const data = await api(`/api/place/${kind}`, { ...state.context, place: state.selectedPlace });
    state.passport.add(data.stamp);
    $("generated").textContent = data.note || data.transcript;
  } catch (error) {
    $("generated").className = "status bad";
    $("generated").textContent = error.message;
  }
}

async function renderEvents() {
  view.innerHTML = sectionHead("Happening Now", "Trip-window events from Ticketmaster when configured.", "<button class='ghost' id='reloadEvents'>Reload</button>") +
    `<div id="eventList" class="view"><div class="status">Loading events.</div></div>`;
  $("reloadEvents").addEventListener("click", renderEvents);
  try {
    const data = await api("/api/events", state.context);
    state.passport.add(data.stamp);
    $("eventList").innerHTML = data.events.length ? data.events.map((event) => `
      <article class="card card-body">
        <strong>${escapeHtml(event.name)}</strong>
        <span>${escapeHtml(event.venue)} · ${escapeHtml(event.date || "")} ${escapeHtml(event.time || "")}</span>
        <p>${escapeHtml(event.why)}</p>
      </article>`).join("") : `<div class="status">No events found for this trip window.</div>`;
  } catch (error) {
    $("eventList").innerHTML = `<div class="status bad">${escapeHtml(error.message)}</div>`;
  }
}

async function renderThreads() {
  view.innerHTML = sectionHead("Local Threads", "Real OSM cultural places with a request ledger transaction.", "<button class='ghost' id='reloadHosts'>Reload</button>") +
    `<div id="hostList" class="grid"><div class="status">Loading local hosts.</div></div>`;
  $("reloadHosts").addEventListener("click", renderThreads);
  try {
    const data = await api("/api/threads/hosts", state.context);
    $("hostList").innerHTML = data.hosts.map(hostCard).join("") || `<div class="status">No local thread candidates found.</div>`;
    bindHostForms(data.hosts);
  } catch (error) {
    $("hostList").innerHTML = `<div class="status bad">${escapeHtml(error.message)}</div>`;
  }
}

function hostCard(host) {
  return `
    <article class="card card-body">
      <p class="eyebrow">${escapeHtml(host.craft)}</p>
      <h2>${escapeHtml(host.name)}</h2>
      <p>${escapeHtml(host.area)}</p>
      <form data-host="${escapeHtml(host.id)}">
        <label>Name<input name="travelerName" required minlength="2" maxlength="80"></label>
        <label>Email<input name="email" type="email" required maxlength="120"></label>
        <label>Message<textarea name="message" required minlength="10" maxlength="600">Hi ${escapeHtml(host.name)}, I would like to learn more about your local cultural experience.</textarea></label>
        <button class="primary" type="submit">Request to connect</button>
      </form>
    </article>`;
}

function bindHostForms(hosts) {
  view.querySelectorAll("form[data-host]").forEach((hostForm) => {
    hostForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const host = hosts.find((item) => item.id === hostForm.dataset.host);
      const formData = new FormData(hostForm);
      try {
        const receipt = await api("/api/threads/request", {
          city: state.context.city,
          hostId: host.id,
          hostName: host.name,
          travelerName: formData.get("travelerName"),
          email: formData.get("email"),
          message: formData.get("message")
        });
        state.passport.add(receipt.stamp);
        hostForm.insertAdjacentHTML("afterend", `<div class="status good">Request saved: ${escapeHtml(receipt.id)}</div>`);
        hostForm.reset();
      } catch (error) {
        hostForm.insertAdjacentHTML("afterend", `<div class="status bad">${escapeHtml(error.message)}</div>`);
      }
    });
  });
}

function renderPassport() {
  const slots = [["smart", "Smart Picks"], ["hidden", "Off Path"], ["heritage", "Heritage"], ["story", "Story"], ["events", "Events"], ["threads", "Threads"]];
  view.innerHTML = sectionHead("Culture Passport", "Stamps appear only after an endpoint succeeds.") +
    `<div class="passport">${slots.map(([id, label]) => `
      <div class="stamp ${state.passport.has(id) ? "earned" : ""}" title="${state.passport.has(id) ? "Completed" : `Complete ${label}`}">
        <strong>${escapeHtml(label)}</strong>
        <span>${state.passport.has(id) ? "Earned" : "Pending"}</span>
      </div>`).join("")}</div>`;
}

function renderEmpty() {
  view.innerHTML = `<div class="empty"><h1>Build a live cultural route from context.</h1><p class="muted">Choose a city and interests, then run the decision engine. The app shows real sources and honest failures where optional keys are missing.</p></div>`;
}

function renderStatus(message, tone = "") {
  view.innerHTML = `<div class="status ${tone}">${escapeHtml(message)}</div>`;
}

function sectionHead(title, detail, action = "") {
  return `<header class="section-head"><div><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(detail)}</p></div>${action}</header>`;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Request failed");
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
