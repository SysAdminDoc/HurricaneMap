// Pure radar timestamp helpers shared by the online fallback and its tests.

export function buildRadarProbeTimes(target, maxMinutes = 60, stepMinutes = 5) {
  if (!(target instanceof Date) || !Number.isFinite(target.getTime())) return [];
  if (!Number.isFinite(maxMinutes) || maxMinutes < 0 || !Number.isFinite(stepMinutes) || stepMinutes <= 0) return [];

  const stepMs = stepMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  const baseMs = Math.floor(target.getTime() / stepMs) * stepMs;
  const candidates = [];
  for (let offsetMs = -maxMs; offsetMs <= maxMs; offsetMs += stepMs) {
    const timeMs = baseMs + offsetMs;
    if (Math.abs(timeMs - target.getTime()) <= maxMs) candidates.push(new Date(timeMs));
  }

  return candidates.sort((a, b) => {
    const distance = Math.abs(a.getTime() - target.getTime()) - Math.abs(b.getTime() - target.getTime());
    return distance || a.getTime() - b.getTime();
  });
}
