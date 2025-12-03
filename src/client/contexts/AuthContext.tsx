import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';

interface User {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  serverAvailable: boolean;
  checkAuth: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverAvailable, setServerAvailable] = useState(true);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const checkAuth = async (retryCount = 0): Promise<void> => {
    try {
      const response = await fetch('/auth/user', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setServerAvailable(true);
      } else {
        setUser(null);
        setServerAvailable(true);
      }
      setLoading(false);
    } catch (error) {
      // Server is unavailable (likely restarting)
      setServerAvailable(false);
      
      // Only log on first failure
      if (retryCount === 0) {
        console.log('Backend server unavailable, will retry...');
      }
      
      // Retry up to 10 times with exponential backoff (covers ~30 seconds of downtime)
      if (retryCount < 10) {
        const delay = Math.min(1000 * Math.pow(1.5, retryCount), 5000);
        
        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        
        retryTimeoutRef.current = setTimeout(() => {
          checkAuth(retryCount + 1);
        }, delay);
      } else {
        console.error('Backend server not responding after multiple retries');
        setUser(null);
        setLoading(false);
      }
    }
  };

  const logout = () => {
    window.location.href = '/auth/logout';
  };

  useEffect(() => {
    checkAuth();
    
    // Cleanup retry timeout on unmount
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Wrapper to match the interface (no retry count parameter)
  const checkAuthPublic = async () => {
    await checkAuth(0);
  };

  return (
    <AuthContext.Provider value={{ user, loading, serverAvailable, checkAuth: checkAuthPublic, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
