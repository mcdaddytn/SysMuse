// === src/lib/dateUtils.ts ===

/**
 * Format the current date for use in filenames
 * Format: MMDDYYYY_HHMMSS
 */
export function formatDateForFilename(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  
  return `${mm}${dd}${yyyy}_${hh}${min}${ss}`;
}

/**
 * Get a timestamp string for the current date
 * Useful for replacing Date.now() with a more readable format
 */
export function getTimestamp(): string {
  return formatDateForFilename();
}
