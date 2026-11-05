/** One real minute is eight game hours, matching the frozen map clock. Day starts at 08:00. */
export const START_HOUR = 8;
export const GAME_HOURS_PER_REAL_MINUTE = 8;
export const GAME_HOURS_PER_REAL_SECOND = GAME_HOURS_PER_REAL_MINUTE / 60;

export function formatClock(clockHours: number): string {
  const whole = Number.isFinite(clockHours) ? clockHours : START_HOUR;
  const day = Math.floor(whole / 24) + 1;
  const normalized = ((whole % 24) + 24) % 24;
  const hour = Math.floor(normalized);
  const minute = Math.floor((normalized - hour) * 60);
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `Day ${day < 1 ? 1 : day}  ${hh}:${mm}`;
}
