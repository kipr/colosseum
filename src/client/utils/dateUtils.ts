/**
 * Extract YYYY-MM-DD from a date string ("YYYY-MM-DD" or an ISO timestamp).
 */
export function toDateOnlyString(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

/**
 * Formats an ISO UTC timestamp from the API for display in the user's local
 * timezone.
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.warn('Invalid date:', dateString);
    return dateString;
  }

  return date.toLocaleString();
}

/**
 * Formats a date string for display as just the date (no time).
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString();
}

/**
 * Formats a date string: time only if today, full date + time if different day.
 */
export function formatCalledAt(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
