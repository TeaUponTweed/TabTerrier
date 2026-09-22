// Config follows you between profiles; pauses and history stay on this machine,
// so pausing on the laptop doesn't unlock the desktop.
const SYNCED = {
  sites: ["news.ycombinator.com"],
  tabLimit: 12,
};
const LOCAL = {
  pauses: { block: null, tabs: null }, // { until: ms, note: string }
  log: [],                             // [{ feature, note, minutes, at }]
};
const FEATURES = ["block", "tabs"];
const STARTUP_GRACE_MS = 15000;

async function getState() {
  const [synced, local] = await Promise.all([
    browser.storage.sync.get(structuredClone(SYNCED)),
    browser.storage.local.get(structuredClone(LOCAL)),
  ]);
  return { ...synced, ...local };
}
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
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules,
    });
  } catch (e) {
    console.error("TabTerrier: could not apply blocking rules.", e);
  }
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

async function addLog(entry) {
  const { log } = await browser.storage.local.get({ log: [] });
  await browser.storage.local.set({
    log: [{ ...entry, at: Date.now() }, ...log].slice(0, 50),
  });
}

async function pause(feature, minutes, note) {
  note = (note || "").trim();
  if (!FEATURES.includes(feature)) throw new Error("Unknown feature.");
  if (!note) throw new Error("Write a note about why you're pausing.");
  if (!(minutes > 0)) throw new Error("Pick a duration.");

  const state = await getState();
  const until = Date.now() + minutes * 60_000;
  state.pauses[feature] = { until, note };
  await browser.storage.local.set({ pauses: state.pauses });
  await addLog({ feature, note, minutes });
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

// One-time move of config from local storage into sync. Runs before anything
// reads state, so an existing install keeps its sites and limit.
async function migrateToSync() {
  const keys = Object.keys(SYNCED);
  const local = await browser.storage.local.get(keys);
  if (!keys.some((k) => local[k] !== undefined)) return;

  const synced = await browser.storage.sync.get(keys);
  const patch = {};
  for (const k of keys) {
    if (local[k] !== undefined && synced[k] === undefined) patch[k] = local[k];
  }
  if (Object.keys(patch).length) {
    await browser.storage.sync.set(patch);
    const readback = await browser.storage.sync.get(Object.keys(patch));
    for (const k of Object.keys(patch)) {
      if (readback[k] === undefined) {
        console.error("TabTerrier: sync did not accept config; keeping local copy.");
        return;
      }
    }
  }
  await browser.storage.local.remove(keys);
}

// Clear expired pauses and re-arm alarms for live ones.
async function reconcile() {
  await migrateToSync();
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

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((k) => k in SYNCED)) refresh();
});

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
    await browser.tabs.update(tab.id, { url: browser.runtime.getURL("limit.html") });
  }
  updateBadge();
});
browser.tabs.onRemoved.addListener(() => updateBadge());

// ---------- blocked-page identity ----------

// DNR redirects without telling us what it caught, and we deliberately keep the
// host out of the redirect URL so it never reaches the address bar or history.
// Recording it here lets blocked.html offer to unblock the site you just tried.
const blockedKey = (tabId) => `blocked:${tabId}`;

function matchedSite(sites, host) {
  return sites.find((s) => host === s || host.endsWith(`.${s}`));
}

browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const state = await getState();
  if (isPaused(state, "block")) return;

  let host = "";
  try {
    host = new URL(details.url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }
  const site = matchedSite(state.sites, host);
  if (!site) return;

  await browser.storage.session.set({ [blockedKey(details.tabId)]: site });
  await browser.tabs.update(details.tabId, {
    url: browser.runtime.getURL("blocked.html"),
  });
});

browser.tabs.onRemoved.addListener((tabId) =>
  browser.storage.session.remove(blockedKey(tabId))
);

// ---------- context menu ----------

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: "block-this-site",
    title: "Block this site with TabTerrier",
    contexts: ["page", "link"],
  });
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "block-this-site") return;
  // linkUrl when you right-click a link, otherwise whatever page you are on.
  await addSite(info.linkUrl || info.pageUrl || tab?.url);
});

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
    await browser.storage.sync.set({ sites: [...state.sites, site].sort() });
    await refresh();
  }
}

async function removeSite(input, note) {
  note = (note || "").trim();
  const site = normalizeSite(input);
  const state = await getState();
  if (!state.sites.includes(site)) throw new Error(`${site} isn't on the list.`);
  if (!note) throw new Error("Write a note about why you're unblocking it.");

  await browser.storage.sync.set({ sites: state.sites.filter((s) => s !== site) });
  // Deliberately no site recorded: the log stays reviewable without naming names.
  await addLog({ feature: "unblock", note });
  await refresh();
}

async function setTabLimit(limit) {
  limit = Math.floor(Number(limit));
  if (!(limit >= 1)) throw new Error("Tab limit must be at least 1.");
  const state = await getState();
  if (limit > state.tabLimit && !isPaused(state, "tabs")) {
    throw new Error("Pause the tab limit to raise it.");
  }
  await browser.storage.sync.set({ tabLimit: limit });
  await updateBadge();
}

// ---------- popup messaging ----------

async function handle(msg, sender) {
  switch (msg.type) {
    case "blockedSite": {
      const tabId = sender?.tab?.id;
      const key = blockedKey(tabId);
      const found = tabId === undefined ? {} : await browser.storage.session.get(key);
      return { site: found[key] ?? null };
    }
    case "pause":       await pause(msg.feature, msg.minutes, msg.note); break;
    case "resume":      await resume(msg.feature); break;
    case "addSite":     await addSite(msg.site); break;
    case "removeSite":  await removeSite(msg.site, msg.note); break;
    case "setTabLimit": await setTabLimit(msg.limit); break;
    case "getState":    break;
    default: throw new Error(`Unknown message: ${msg.type}`);
  }
  const { sites, ...rest } = await getState();
  // Only the count leaves the background page: the list stays private.
  return { ...rest, siteCount: sites.length, tabCount: await countTabs(), now: Date.now() };
}

browser.runtime.onMessage.addListener((msg, sender) => handle(msg, sender));
