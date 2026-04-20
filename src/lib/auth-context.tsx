import { createContext, useContext, type ReactNode } from "react";

// Free-trial mode: no real authentication. A fixed demo user is used so all
// gated pages, queries, and inserts work without a sign-in flow. RLS policies
// have been opened up to permit anon access for this trial.
const DEMO_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "trial@joyofassessment.local",
} as const;

interface AuthContextValue {
  user: { id: string; email: string };
  session: null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const value: AuthContextValue = {
  user: DEMO_USER,
  session: null,
  loading: false,
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextValue>(value);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
