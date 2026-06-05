import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Admin } from "../types";

type AuthContextValue = {
  admin: Admin | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const response = await api.get<{ admin: Admin }>("/auth/me");
      setAdmin(response.data.admin);
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const response = await api.post<{ admin: Admin }>("/auth/login", { email, password });
    setAdmin(response.data.admin);
  }

  async function logout() {
    await api.post("/auth/logout");
    setAdmin(null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(
    () => ({ admin, loading, login, logout, refresh }),
    [admin, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

