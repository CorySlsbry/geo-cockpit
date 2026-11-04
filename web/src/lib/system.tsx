import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

export type Sys = {
  battery?: { present: boolean; percent?: number; plugged?: boolean; secs_left?: number | null };
  claude?: { cli_available?: boolean; api_available?: boolean; prefers?: string };
  claude_ok?: boolean;
  capabilities?: Record<string, boolean>;
  user?: { email: string; role: string };
  server?: { port: number; public_host?: string };
  dev?: boolean;
} | null;

const Ctx = createContext<{ sys: Sys; error: string | null; refresh: () => void }>({
  sys: null,
  error: null,
  refresh: () => {},
});

export function SystemProvider({ children }: { children: ReactNode }) {
  const [sys, setSys] = useState<Sys>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    api
      .system()
      .then((d) => {
        setSys(d);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, []);
  return <Ctx.Provider value={{ sys, error, refresh }}>{children}</Ctx.Provider>;
}

export const useSystem = () => useContext(Ctx);
