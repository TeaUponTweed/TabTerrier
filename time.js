// Shared by the popup, the blocked page, and the tab-limit page.
function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Ticks every second until `until` passes, then calls onDone exactly once. A
// deadline that has already elapsed finishes on the spot, without a timer.
function startCountdown(until, onTick, onDone) {
  let timer = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  // Returns false once the deadline is behind us, so the first call decides
  // whether an interval is worth starting at all.
  const step = () => {
    const left = until - Date.now();
    if (left <= 0) {
      stop();
      onDone?.();
      return false;
    }
    onTick(formatRemaining(left));
    return true;
  };
  if (step()) timer = setInterval(step, 1000);
  return stop;
}
