import { useCallback } from 'react';
import { logout as apiLogout, logoutServer, isAuthenticated } from '../api/client';

export function useAuth() {
  const logout = useCallback(async () => {
    try {
      await logoutServer();
    } catch (_) {
      // Best-effort server logout; always clear locally
    }
    apiLogout();
  }, []);

  return {
    isAuthenticated: isAuthenticated(),
    logout,
  };
}
