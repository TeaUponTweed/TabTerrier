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
const STARTUP_GRACE_MS = 15000;
const FLASH_MS = 1500;
const BADGE = {
  text:    "#e7ddc9",
  idle:    "#57534a",
  paused:  "#8a6a1f",
  over:    "#8f2c1f",
  ok:      "#4a5a23",
};

// Seeded while this script is evaluated, which happens before any listener
// below can fire. Everyone awaits this one promise, so nobody can catch the
// value unset and mistake a session restore for ordinary tab opening. Session
// storage dies with the browser, so a real restart re-seeds it, while an event
// page rebuilt mid-session finds the original boot time and keeps it.
const bootReady = browser.storage.session.get({ bootAt: 0 }).then(async ({ bootAt }) => {
  if (!bootAt) {
    bootAt = Date.now();
    await browser.storage.session.set({ bootAt });
  }
  return bootAt;
});

// Several writes below are read-modify-write. Funnelling them through one queue
// stops two quick actions from clobbering each other's entry. A failed write
// must not wedge the queue, hence the same handler on both paths.
let writes = Promise.resolve();
const serialize = (fn) => (writes = writes.then(fn, fn));

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
  const color = anyPaused ? BADGE.paused : count >= state.tabLimit ? BADGE.over : BADGE.idle;
  browser.action.setBadgeText({ text: String(count) });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setBadgeTextColor({ color: BADGE.text });
}

// The context menu has no UI of its own, so the badge carries the news for a
// moment. If the event page is torn down before the timer fires, the next tab
// opened or closed puts the count back.
let flashTimer = null;
async function flash(text, color) {
  clearTimeout(flashTimer);
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
  flashTimer = setTimeout(updateBadge, FLASH_MS);
}

async function refresh() {
  await syncRules();
  await updateBadge();
}

// ---------- pausing ----------

function addLog(entry) {
  return serialize(async () => {
    const { log } = await browser.storage.local.get({ log: [] });
    await browser.storage.local.set({
      log: [{ ...entry, at: Date.now() }, ...log].slice(0, 50),
    });
  });
}

// Reads the pause map fresh inside the queue, hands it to `mutate`, and writes
// it back unless `mutate` returns false to say nothing changed.
function updatePauses(mutate) {
  return serialize(async () => {
    const { pauses } = await browser.storage.local.get({
      pauses: structuredClone(LOCAL.pauses),
    });
    if (mutate(pauses) === false) return pauses;
    await browser.storage.local.set({ pauses });
    return pauses;
  });
}

async function pause(feature, minutes, note) {
  note = (note || "").trim();
  if (!FEATURES.includes(feature)) throw new Error("Unknown feature.");
  if (!note) throw new Error("Write a note about why you're pausing.");
  if (!(minutes > 0)) throw new Error("Pick a duration.");

  const until = Date.now() + minutes * 60_000;
  await updatePauses((pauses) => {
    pauses[feature] = { until, note };
  });
  await addLog({ feature, note, minutes });
  browser.alarms.create(`resume:${feature}`, { when: until });
  await refresh();
}

async function resume(feature) {
  await updatePauses((pauses) => {
    pauses[feature] = null;
  });
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
  await updatePauses((pauses) => {
    let changed = false;
    for (const f of FEATURES) {
      const p = pauses[f];
      if (!p) continue;
      if (p.until <= Date.now()) {
        pauses[f] = null;
        changed = true;
      } else {
        browser.alarms.create(`resume:${f}`, { when: p.until });
      }
    }
    return changed;
  });
  await refresh();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((k) => k in SYNCED)) refresh();
});

browser.runtime.onStartup.addListener(reconcile);
browser.runtime.onInstalled.addListener(reconcile);

// ---------- tab limit ----------

browser.tabs.onCreated.addListener(async (tab) => {
  const bootAt = await bootReady;
  const state = await getState();
  const inGrace = Date.now() - bootAt < STARTUP_GRACE_MS;

  if (!inGrace && !isPaused(state, "tabs") && (await countTabs()) > state.tabLimit) {
    await browser.tabs.update(tab.id, { url: browser.runtime.getURL("limit.html") });
  }
  updateBadge();
});

browser.tabs.onRemoved.addListener((tabId) => {
  updateBadge();
  // A closed tab also takes its blocked-page record with it (see below).
  browser.storage.session.remove(blockedKey(tabId));
});

// ---------- blocked-page identity ----------

// Two things block a request and neither says what it caught. The DNR rule is
// the network-level backstop; on its own it would leave you on the browser's
// error page, so the webNavigation listener below is what swaps in blocked.html
// instead. We deliberately keep the destination out of that page's URL, so it
// never reaches the address bar or history. Parking it in session storage -
// which dies with the tab, and with the browser - lets blocked.html name the
// site and send you back to the exact page once blocking is paused.
const blockedKey = (tabId) => `blocked:${tabId}`;

// An older build stored a bare site string here, and session storage outlives
// an extension reload, so tolerate both shapes.
const readBlocked = (value) =>
  typeof value === "string" ? { site: value, url: null } : value ?? null;

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

  // `site` is the list entry, which is what you would unblock; `url` is where
  // you were actually headed, which is where "Continue to site" should land.
  await browser.storage.session.set({
    [blockedKey(details.tabId)]: { site, url: details.url },
  });
  await browser.tabs.update(details.tabId, {
    url: browser.runtime.getURL("blocked.html"),
  });
});

// ---------- context menu ----------

// Created here rather than in onInstalled: an event page can be torn down and
// rebuilt at any time, and removeAll keeps a repeat create harmless.
browser.menus.removeAll().then(() =>
  browser.menus.create({
    id: "block-this-site",
    title: "Block this site with TabTerrier",
    contexts: ["page", "link"],
  })
);

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "block-this-site") return;
  // linkUrl when you right-click a link, otherwise whatever page you are on.
  try {
    await addSite(info.linkUrl || info.pageUrl || tab?.url);
    await flash("+", BADGE.ok);
  } catch (e) {
    // Nothing on screen belongs to us here, so the badge has to say it.
    console.error("TabTerrier: could not block that.", e);
    await flash("!", BADGE.over);
  }
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
      return readBlocked(found[key]) ?? { site: null, url: null };
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
