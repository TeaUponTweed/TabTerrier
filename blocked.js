const $ = (sel) => document.querySelector(sel);

// `site` is the list entry we would unblock; `target` is the page you were
// actually trying to reach, which may be a subdomain or a deep link.
let site = null;
let target = null;

async function load() {
  const found = await browser.runtime.sendMessage({ type: "blockedSite" });
  site = found.site;
  target = found.url || (site ? `https://${site}` : null);
  $("#site").textContent = site ?? "";
  // Without a known host there is nothing to unblock or return to.
  $("#unblock-form").hidden = !site;
  $("#retry").hidden = !target;
}

function showUnblockActions(until) {
  $("#pause-form").hidden = true;
  $("#unblock-actions").hidden = false;
  startCountdown(
    until,
    (left) => ($("#notice").textContent = `Blocking resumes in ${left}.`),
    () => ($("#notice").textContent = "Blocking has resumed.")
  );
}

$("#pause-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#error").textContent = "";
  const form = e.target;
  try {
    const s = await browser.runtime.sendMessage({
      type: "pause",
      feature: "block",
      minutes: Number(form.minutes.value),
      note: form.note.value,
    });
    showUnblockActions(s.pauses.block.until);
  } catch (err) {
    $("#error").textContent = err.message;
  }
});

$("#retry").addEventListener("click", () => {
  if (target) location.href = target;
});

$("#unblock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#error").textContent = "";
  try {
    await browser.runtime.sendMessage({
      type: "removeSite",
      site,
      note: e.target.note.value,
    });
    $("#notice").textContent = `${site} removed from your list.`;
    $("#unblock-form").hidden = true;
    // Nothing left to pause once the site is off the list.
    $("#pause-form").hidden = true;
    $("#unblock-actions").hidden = false;
  } catch (err) {
    $("#error").textContent = err.message;
  }
});

// The unblock form and retry button start hidden, so a failed lookup would
// otherwise leave a page with nothing on it and no explanation.
load().catch((e) => {
  console.error("TabTerrier: could not identify the blocked site.", e);
  $("#error").textContent = "Couldn't tell which site this was.";
});
