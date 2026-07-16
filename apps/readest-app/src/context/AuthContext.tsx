'use client';

import { createContext, useContext, useCallback, useMemo, ReactNode, useEffect } from 'react';
import { User } from '@supabase/supabase-js';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }, []);

  const login = useCallback((_newToken: string, _newUser: User) => {}, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }, []);

  const refresh = useCallback(() => {}, []);

  const value = useMemo(
    () => ({ token: null, user: null, login, logout, refresh }),
    [login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
