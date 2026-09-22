const $ = (sel, root = document) => root.querySelector(sel);
const LABELS = { block: "Paused sites", tabs: "Paused tabs", unblock: "Unblocked a site" };
const PREVIEW = 5;
const FEATURES = ["block", "tabs"];
const RESUMES = { block: "Blocking resumes in", tabs: "Limit resumes in" };

let showAll = false;

let noticeTimer = null;
function notice(text) {
  clearTimeout(noticeTimer);
  $("#notice").textContent = text;
  noticeTimer = setTimeout(() => ($("#notice").textContent = ""), 4000);
}

async function send(msg, okText) {
  $("#error").textContent = "";
  try {
    render(await browser.runtime.sendMessage(msg));
    if (okText) notice(okText);
  } catch (e) {
    $("#error").textContent = e.message;
    notice("");
  }
}

let stopTicking = [];

function render(s) {
  // Drop the previous tick loops before the DOM they wrote to is reused.
  stopTicking.forEach((stop) => stop());
  stopTicking = [];

  const paused = {};
  for (const f of FEATURES) {
    const p = s.pauses[f];
    paused[f] = !!p && p.until > s.now;
    const box = $(`.pause[data-feature="${f}"]`);
    $(".paused-view", box).hidden = !paused[f];
    $(".pause-form", box).hidden = paused[f];
    if (paused[f]) {
      $(".note", box).textContent = `“${p.note}”`;
      const el = $(".remaining", box);
      stopTicking.push(
        startCountdown(
          p.until,
          (left) => (el.textContent = `${RESUMES[f]} ${left}`),
          // Pause has elapsed; pull fresh state so the form comes back.
          () => send({ type: "getState" })
        )
      );
    }
  }

  $("#block .status").textContent = paused.block
    ? "Paused"
    : `Blocking ${s.siteCount} site${s.siteCount === 1 ? "" : "s"}`;

  $("#tabs .status").textContent =
    `${s.tabCount} / ${s.tabLimit} tabs` + (paused.tabs ? " · limit paused" : "");
  if (document.activeElement !== $("#limit")) $("#limit").value = s.tabLimit;

  const shown = showAll ? s.log : s.log.slice(0, PREVIEW);
  $("#log").classList.toggle("scroll", showAll);
  $("#log").replaceChildren(
    ...shown.map((entry) => {
      const li = document.createElement("li");
      const when = new Date(entry.at).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      const parts = [when, LABELS[entry.feature] ?? entry.feature];
      if (entry.minutes) parts.push(`${entry.minutes}m`);
      li.textContent = `${parts.join(" · ")} — ${entry.note}`;
      return li;
    })
  );

  const more = s.log.length > PREVIEW;
  $("#show-all").hidden = !more;
  if (more) $("#show-all").textContent = showAll ? "Show fewer" : `Show all ${s.log.length}`;
  if (!s.log.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "None yet.";
    $("#log").replaceChildren(li);
  }
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
  send({ type: "addSite", site: e.target.site.value }, "Added.");
  e.target.reset();
});

$("#remove-site").addEventListener("submit", (e) => {
  e.preventDefault();
  send(
    { type: "removeSite", site: e.target.site.value, note: e.target.note.value },
    "Unblocked."
  );
  e.target.reset();
});

$("#show-all").addEventListener("click", () => {
  showAll = !showAll;
  send({ type: "getState" });
});

$("#add-current").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  send({ type: "addSite", site: tab?.url }, "Added.");
});

$("#limit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send({ type: "setTabLimit", limit: $("#limit").value });
});

send({ type: "getState" });
