const $ = (sel) => document.querySelector(sel);
const CLOSE_AFTER = 5;

let remaining = CLOSE_AFTER;
let ticker = null;

async function closeSelf() {
  const tab = await browser.tabs.getCurrent();
  if (tab) browser.tabs.remove(tab.id);
}

function stopCountdown(reason) {
  clearInterval(ticker);
  ticker = null;
  $("#countdown").textContent = reason;
  $("#keep-open").hidden = true;
}

function startCountdown() {
  $("#countdown").textContent = `Closing in ${remaining}...`;
  ticker = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(ticker);
      closeSelf();
      return;
    }
    $("#countdown").textContent = `Closing in ${remaining}...`;
  }, 1000);
}

// Show the real limit rather than a hardcoded number.
browser.runtime.sendMessage({ type: "getState" }).then((s) => {
  $("#message").textContent = `You're at your limit of ${s.tabLimit} tabs.`;
});

$("#close-now").addEventListener("click", closeSelf);
$("#keep-open").addEventListener("click", () => stopCountdown("Countdown stopped."));

$("#pause-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#error").textContent = "";
  const form = e.target;
  try {
    const s = await browser.runtime.sendMessage({
      type: "pause",
      feature: "tabs",
      minutes: Number(form.minutes.value),
      note: form.note.value,
    });
    const until = new Date(s.pauses.tabs.until);
    // The original destination is gone, so say so instead of pretending.
    stopCountdown(
      `Limit paused until ${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
    );
    form.hidden = true;
    $("#message").textContent = "Limit paused. Reopen the page you wanted.";
    $(".detail").textContent = "";
  } catch (err) {
    $("#error").textContent = err.message;
  }
});

startCountdown();
