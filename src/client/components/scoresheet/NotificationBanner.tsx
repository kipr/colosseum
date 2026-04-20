export interface ScoresheetNotification {
  message: string;
  type: 'success' | 'error';
}

interface NotificationBannerProps {
  notification: ScoresheetNotification | null;
}

/** Centered transient banner used by ScoresheetForm to confirm submissions. */
export function NotificationBanner({ notification }: NotificationBannerProps) {
  if (!notification) return null;
  return (
    <div className={`notification-overlay ${notification.type}`}>
      <div className="notification-content">
        {notification.type === 'success' ? '✓' : '✕'} {notification.message}
      </div>
    </div>
  );
}
