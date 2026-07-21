/**
 * marketHours.js — pure US cash-session clock helpers.
 *
 * Phase S W1 item 1: extracted from useWebSocketTicks.js so panels that
 * need to know "is the US cash market open right now?" (GlobalIndicesPanel's
 * FUTURES-section ordering, feed-status downgrades) share ONE definition of
 * RTH instead of re-implementing the ET math.
 *
 * NYSE/NASDAQ regular trading hours: 9:30-16:00 ET, Monday-Friday.
 * Holidays are intentionally NOT modeled (same behaviour as the original
 * useWebSocketTicks check): on a weekday holiday the market reads "open",
 * which at worst re-orders a section — never shows wrong prices.
 */

/**
 * Is the US cash market (NYSE/NASDAQ) inside regular trading hours?
 * @param {Date} [now] — injectable for tests; defaults to the current time.
 * @returns {boolean}
 */
export function isUsMarketOpen(now = new Date()) {
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay(); // 0=Sun, 6=Sat
  const timeInMinutes = etTime.getHours() * 60 + etTime.getMinutes();

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = timeInMinutes >= 570 && timeInMinutes < 960; // 9:30=570, 16:00=960

  return isWeekday && isMarketHours;
}

/**
 * Is the B3 (Sao Paulo) cash market inside regular trading hours?
 * B3 regular session: 10:00-16:55 BRT, Monday-Friday (auction tails and
 * holidays intentionally not modeled — same tolerance as isUsMarketOpen).
 * @param {Date} [now] — injectable for tests; defaults to the current time.
 * @returns {boolean}
 */
export function isB3MarketOpen(now = new Date()) {
  const spTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = spTime.getDay(); // 0=Sun, 6=Sat
  const timeInMinutes = spTime.getHours() * 60 + spTime.getMinutes();

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = timeInMinutes >= 600 && timeInMinutes < 1015; // 10:00=600, 16:55=1015

  return isWeekday && isMarketHours;
}
