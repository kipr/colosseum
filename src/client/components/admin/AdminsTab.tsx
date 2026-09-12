import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { adminUsersQueryOptions } from '../../queries/admins';
import type { AdminUser } from '../../api/admins';
import QueryFeedback, { queryData } from '../QueryFeedback';
import './AdminsTab.css';

export default function AdminsTab() {
  const { user, loading } = useAuth();
  const query = useQuery({
    ...adminUsersQueryOptions(user?.id ?? 0),
    enabled: Boolean(user?.isAdmin && !loading),
  });
  const admins = queryData(query) ?? [];
  const loadAdmins = () => void query.refetch();

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return 'Never';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateString);
  };

  const getActivityStatus = (admin: AdminUser) => {
    if (admin.isActive) return { label: 'Active now', className: 'active' };
    if (admin.isRecentlyActive)
      return {
        label: formatRelativeTime(admin.last_activity),
        className: 'recent',
      };
    if (admin.last_activity)
      return {
        label: formatRelativeTime(admin.last_activity),
        className: 'inactive',
      };
    return { label: 'Never', className: 'inactive' };
  };

  const activeCount = admins.filter((a) => a.isActive).length;
  const recentCount = admins.filter(
    (a) => a.isRecentlyActive && !a.isActive,
  ).length;
  if (!user?.isAdmin) return <p>Admin access required.</p>;

  return (
    <div className="admins-tab">
      <QueryFeedback query={query} />
      <div className="admins-header">
        <h2>👥 Admin Users</h2>
        <div className="admins-summary">
          {activeCount > 0 && (
            <span className="active-count">
              <span className="status-dot active"></span>
              {activeCount} active
            </span>
          )}
          {recentCount > 0 && (
            <span className="recent-count">
              <span className="status-dot recent"></span>
              {recentCount} recent
            </span>
          )}
          <span className="total-count">{admins.length} total</span>
        </div>
      </div>

      <div className="admins-list">
        {query.isLoading ||
        (query.isError && !queryData(query)) ? null : admins.length === 0 ? (
          <p className="no-admins">No admin users found.</p>
        ) : (
          admins.map((admin) => {
            const activityStatus = getActivityStatus(admin);
            return (
              <div
                key={admin.id}
                className={`admin-card ${activityStatus.className}`}
              >
                <div className="admin-status">
                  <span
                    className={`status-dot ${activityStatus.className}`}
                  ></span>
                </div>
                <div className="admin-info">
                  <div className="admin-name">{admin.name || 'Unknown'}</div>
                  <div className="admin-email">{admin.email}</div>
                </div>
                <div className="admin-details">
                  <div className="admin-activity">
                    <span
                      className={`activity-label ${activityStatus.className}`}
                    >
                      {activityStatus.label}
                    </span>
                    {admin.last_activity && (
                      <span
                        className="activity-timestamp"
                        title={admin.last_activity}
                      >
                        {formatDate(admin.last_activity)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="admins-footer">
        <small>Status updates every 30 seconds</small>
        <button className="btn btn-secondary" onClick={loadAdmins}>
          🔄 Refresh
        </button>
      </div>
    </div>
  );
}
