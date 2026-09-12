import { requestJson } from './http';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  isActive: boolean;
  isRecentlyActive: boolean;
  last_activity: string | null;
  created_at: string;
  updated_at: string;
}
export function getAdminUsers(signal?: AbortSignal) {
  return requestJson<AdminUser[]>('/api/admin/users', { signal });
}
