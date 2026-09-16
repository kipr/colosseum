import { useMatches } from 'react-router-dom';
import {
  isAdminView,
  type AdminRouteHandle,
  type AdminView,
} from '../utils/routes';

interface AdminRouteState {
  activeTab: AdminView;
  eventIdParam?: string;
}

export function useAdminRoute(): AdminRouteState {
  const matches = useMatches();
  const tabMatch = [...matches].reverse().find((match) => {
    const handle = match.handle as Partial<AdminRouteHandle> | undefined;
    return isAdminView(handle?.adminView);
  });
  const handle = tabMatch?.handle as AdminRouteHandle | undefined;

  return {
    activeTab: handle?.adminView ?? 'events',
    eventIdParam: tabMatch?.params.eventId,
  };
}
