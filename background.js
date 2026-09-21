const DEFAULTS = {
  sites: ["news.ycombinator.com"],
  tabLimit: 12,
  pauses: { block: null, tabs: null }, // { until: ms, note: string }
  log: [],                             // [{ feature, note, minutes, at }]
};
const FEATURES = ["block", "tabs"];
const STARTUP_GRACE_MS = 15000;

const getState = () => browser.storage.local.get(structuredClone(DEFAULTS));
const isPaused = (state, f) => !!state.pauses[f] && state.pauses[f].until > Date.now();
const countTabs = async () => (await browser.tabs.query({})).length;

// ---------- enforcement ----------

async function syncRules() {
  const state = await getState();
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  const addRules = [];
  if (!isPaused(state, "block") && state.sites.length) {
    addRules.push({
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        requestDomains: state.sites, // matches subdomains too
        resourceTypes: ["main_frame", "sub_frame"],
      },
    });
  }
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });
}

async function updateBadge() {
  const state = await getState();
  const count = await countTabs();
  const anyPaused = FEATURES.some((f) => isPaused(state, f));
  const color = anyPaused ? "#8a6a1f" : count >= state.tabLimit ? "#8f2c1f" : "#57534a";
  browser.action.setBadgeText({ text: String(count) });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setBadgeTextColor({ color: "#e7ddc9" });
}

async function refresh() {
  await syncRules();
  await updateBadge();
}

// ---------- pausing ----------

async function pause(feature, minutes, note) {
  note = (note || "").trim();
  if (!FEATURES.includes(feature)) throw new Error("Unknown feature.");
  if (!note) throw new Error("Write a note about why you're pausing.");
  if (!(minutes > 0)) throw new Error("Pick a duration.");

  const state = await getState();
  const until = Date.now() + minutes * 60_000;
  state.pauses[feature] = { until, note };
  state.log = [{ feature, note, minutes, at: Date.now() }, ...state.log].slice(0, 50);
  await browser.storage.local.set({ pauses: state.pauses, log: state.log });
  browser.alarms.create(`resume:${feature}`, { when: until });
  await refresh();
}

async function resume(feature) {
  const state = await getState();
  state.pauses[feature] = null;
  await browser.storage.local.set({ pauses: state.pauses });
  await browser.alarms.clear(`resume:${feature}`);
  await refresh();
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("resume:")) resume(alarm.name.slice("resume:".length));
});

// Clear expired pauses and re-arm alarms for live ones.
async function reconcile() {
  const state = await getState();
  let changed = false;
  for (const f of FEATURES) {
    const p = state.pauses[f];
    if (!p) continue;
    if (p.until <= Date.now()) {
      state.pauses[f] = null;
      changed = true;
    } else {
      browser.alarms.create(`resume:${f}`, { when: p.until });
    }
  }
  if (changed) await browser.storage.local.set({ pauses: state.pauses });
  await refresh();
}

browser.runtime.onStartup.addListener(async () => {
  await browser.storage.session.set({ bootAt: Date.now() });
  await reconcile();
});
browser.runtime.onInstalled.addListener(reconcile);

// ---------- tab limit ----------

browser.tabs.onCreated.addListener(async (tab) => {
  const { bootAt = 0 } = await browser.storage.session.get("bootAt");
  const state = await getState();
  const inGrace = Date.now() - bootAt < STARTUP_GRACE_MS;

  if (!inGrace && !isPaused(state, "tabs") && (await countTabs()) > state.tabLimit) {
    await browser.tabs.remove(tab.id);
    browser.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-96.png",
      title: "Tab limit reached",
      message: `You're at your limit of ${state.tabLimit} tabs. Close one first, or pause the limit.`,
    });
  }
  updateBadge();
});
browser.tabs.onRemoved.addListener(() => updateBadge());

// ---------- settings ----------

function normalizeSite(input) {
  const raw = (input || "").trim().toLowerCase();
  let host = "";
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {}
  if (!host || !host.includes(".")) throw new Error("That doesn't look like a website.");
  return host.replace(/^www\./, "");
}

async function addSite(input) {
  const site = normalizeSite(input);
  const state = await getState();
  if (!state.sites.includes(site)) {
    await browser.storage.local.set({ sites: [...state.sites, site].sort() });
    await refresh();
  }
}

async function removeSite(site) {
  const state = await getState();
  if (!isPaused(state, "block")) throw new Error("Pause site blocking to remove a site.");
  await browser.storage.local.set({ sites: state.sites.filter((s) => s !== site) });
  await refresh();
}

async function setTabLimit(limit) {
  limit = Math.floor(Number(limit));
  if (!(limit >= 1)) throw new Error("Tab limit must be at least 1.");
  const state = await getState();
  if (limit > state.tabLimit && !isPaused(state, "tabs")) {
    throw new Error("Pause the tab limit to raise it.");
  }
  await browser.storage.local.set({ tabLimit: limit });
  await updateBadge();
}

// ---------- popup messaging ----------

async function handle(msg) {
  switch (msg.type) {
    case "pause":       await pause(msg.feature, msg.minutes, msg.note); break;
    case "resume":      await resume(msg.feature); break;
    case "addSite":     await addSite(msg.site); break;
    case "removeSite":  await removeSite(msg.site); break;
    case "setTabLimit": await setTabLimit(msg.limit); break;
    case "getState":    break;
    default: throw new Error(`Unknown message: ${msg.type}`);
  }
  return { ...(await getState()), tabCount: await countTabs(), now: Date.now() };
}

browser.runtime.onMessage.addListener((msg) => handle(msg));
