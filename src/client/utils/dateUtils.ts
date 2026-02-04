/**
 * Formats a date string from the database for display in the user's local timezone.
 * SQLite stores CURRENT_TIMESTAMP as UTC without timezone indicator.
 * This function ensures proper parsing and local display.
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  try {
    // SQLite dates come as "YYYY-MM-DD HH:MM:SS" in UTC
    // Add 'Z' to indicate UTC if no timezone info present
    let normalizedDate = dateString;

    // Check if it's a SQLite format date (has space instead of T, no timezone)
    if (
      dateString.includes(' ') &&
      !dateString.includes('Z') &&
      !dateString.includes('+')
    ) {
      // Replace space with T and add Z for UTC
      normalizedDate = dateString.replace(' ', 'T') + 'Z';
    } else if (
      !dateString.includes('Z') &&
      !dateString.includes('+') &&
      dateString.includes('T')
    ) {
      // ISO format but missing timezone
      normalizedDate = dateString + 'Z';
    }

    const date = new Date(normalizedDate);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('Invalid date:', dateString);
      return dateString;
    }

    return date.toLocaleString();
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString;
  }
}

/**
 * Formats a date string for display as just the date (no time).
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  try {
    let normalizedDate = dateString;

    if (
      dateString.includes(' ') &&
      !dateString.includes('Z') &&
      !dateString.includes('+')
    ) {
      normalizedDate = dateString.replace(' ', 'T') + 'Z';
    } else if (
      !dateString.includes('Z') &&
      !dateString.includes('+') &&
      dateString.includes('T')
    ) {
      normalizedDate = dateString + 'Z';
    }

    const date = new Date(normalizedDate);

    if (isNaN(date.getTime())) {
      return dateString;
    }

    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

/**
 * Formats a date string with more detail including timezone.
 */
export function formatDateTimeVerbose(
  dateString: string | null | undefined,
): string {
  if (!dateString) return '-';

  try {
    let normalizedDate = dateString;

    if (
      dateString.includes(' ') &&
      !dateString.includes('Z') &&
      !dateString.includes('+')
    ) {
      normalizedDate = dateString.replace(' ', 'T') + 'Z';
    } else if (
      !dateString.includes('Z') &&
      !dateString.includes('+') &&
      dateString.includes('T')
    ) {
      normalizedDate = dateString + 'Z';
    }

    const date = new Date(normalizedDate);

    if (isNaN(date.getTime())) {
      return dateString;
    }

    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return dateString;
  }
}

/**
 * Formats a date string: time only if today, full date + time if different day.
 */
export function formatCalledAt(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  try {
    let normalizedDate = dateString;
    if (
      dateString.includes(' ') &&
      !dateString.includes('Z') &&
      !dateString.includes('+')
    ) {
      normalizedDate = dateString.replace(' ', 'T') + 'Z';
    } else if (
      !dateString.includes('Z') &&
      !dateString.includes('+') &&
      dateString.includes('T')
    ) {
      normalizedDate = dateString + 'Z';
    }

    const date = new Date(normalizedDate);
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
  } catch {
    return dateString;
  }
}
