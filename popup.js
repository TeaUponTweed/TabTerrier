const $ = (sel, root = document) => root.querySelector(sel);
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const LABELS = { block: "Sites", tabs: "Tabs" };

async function send(msg) {
  $("#error").textContent = "";
  try {
    render(await browser.runtime.sendMessage(msg));
  } catch (e) {
    $("#error").textContent = e.message;
  }
}

function render(s) {
  const paused = {};
  for (const f of ["block", "tabs"]) {
    const p = s.pauses[f];
    paused[f] = !!p && p.until > s.now;
    const box = $(`.pause[data-feature="${f}"]`);
    $(".paused-view", box).hidden = !paused[f];
    $(".pause-form", box).hidden = paused[f];
    if (paused[f]) $(".note", box).textContent = `Paused until ${time(p.until)} — “${p.note}”`;
  }

  $("#block .status").textContent = paused.block
    ? "Paused"
    : `Blocking ${s.sites.length} site${s.sites.length === 1 ? "" : "s"}`;

  const list = $("#sites");
  list.replaceChildren(
    ...s.sites.map((site) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = site;
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.className = "link";
      btn.dataset.site = site;
      btn.disabled = !paused.block;
      btn.title = paused.block ? "" : "Pause blocking to remove sites";
      li.append(name, btn);
      return li;
    })
  );

  $("#tabs .status").textContent =
    `${s.tabCount} / ${s.tabLimit} tabs` + (paused.tabs ? " · limit paused" : "");
  if (document.activeElement !== $("#limit")) $("#limit").value = s.tabLimit;

  $("#log").replaceChildren(
    ...s.log.slice(0, 5).map((entry) => {
      const li = document.createElement("li");
      const when = new Date(entry.at).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      li.textContent = `${when} · ${LABELS[entry.feature]} · ${entry.minutes}m — ${entry.note}`;
      return li;
    })
  );
  if (!s.log.length) $("#log").innerHTML = "<li class='muted'>None yet.</li>";
}

document.querySelectorAll(".pause").forEach((box) => {
  const feature = box.dataset.feature;
  $(".pause-form", box).addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    send({ type: "pause", feature, minutes: Number(form.minutes.value), note: form.note.value });
    form.reset();
  });
  $(".resume", box).addEventListener("click", () => send({ type: "resume", feature }));
});

$("#add-site").addEventListener("submit", (e) => {
  e.preventDefault();
  send({ type: "addSite", site: e.target.site.value });
  e.target.reset();
});

$("#add-current").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  send({ type: "addSite", site: tab?.url });
});

$("#sites").addEventListener("click", (e) => {
  const site = e.target.dataset?.site;
  if (site) send({ type: "removeSite", site });
});

$("#save-limit").addEventListener("click", () =>
  send({ type: "setTabLimit", limit: $("#limit").value })
);

send({ type: "getState" });
