const $ = (sel) => document.querySelector(sel);

let site = null;

async function load() {
  const { site: found } = await browser.runtime.sendMessage({ type: "blockedSite" });
  site = found;
  $("#site").textContent = site ? site : "";
  // Without a known host there is nothing to unblock or return to.
  $("#unblock").hidden = !site;
  $("#retry").hidden = !site;
}

function showUnblockActions(until) {
  $("#pause-form").hidden = true;
  $("#unblock-actions").hidden = false;
  $("#notice").textContent = `Blocking paused until ${until.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}.`;
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
    showUnblockActions(new Date(s.pauses.block.until));
  } catch (err) {
    $("#error").textContent = err.message;
  }
});

$("#retry").addEventListener("click", () => {
  if (site) location.href = `https://${site}`;
});

$("#unblock").addEventListener("click", async () => {
  $("#error").textContent = "";
  try {
    await browser.runtime.sendMessage({ type: "removeSite", site });
    $("#notice").textContent = `${site} removed from your list.`;
    $("#unblock").hidden = true;
  } catch (err) {
    $("#error").textContent = err.message;
  }
});

load();
