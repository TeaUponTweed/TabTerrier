// Shared by the popup, the blocked page, and the tab-limit page.
function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Ticks every second until `until` passes, then calls onDone once.
function startCountdown(until, onTick, onDone) {
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const step = () => {
    const left = until - Date.now();
    if (left <= 0) {
      stop();
      onDone?.();
      return;
    }
    onTick(formatRemaining(left));
  };
  step();
  timer = setInterval(step, 1000);
  return stop;
}
