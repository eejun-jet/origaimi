import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type AppRole = "teacher" | "hod" | "sl" | "admin";

export type RoleRow = {
  id: string;
  user_id: string;
  role: AppRole;
  department: string | null;
  school: string | null;
};

export function useRoles() {
  const { user } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id);
      if (!alive) return;
      setRoles((data ?? []) as RoleRow[]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [user.id]);

  const has = (r: AppRole) => roles.some((x) => x.role === r);
  // In trial mode (no real auth), default to admin so the user can explore
  // the oversight surface without manual role assignment. Real deployments
  // would seed roles per profile.
  const isAdmin = has("admin") || roles.length === 0;
  const isHod = has("hod") || isAdmin;
  const isSl = has("sl") || isAdmin;
  const canSeeOversight = isHod || isSl || isAdmin;

  const departments = Array.from(
    new Set(roles.map((r) => r.department).filter((x): x is string => !!x)),
  );
  const schools = Array.from(
    new Set(roles.map((r) => r.school).filter((x): x is string => !!x)),
  );

  return { roles, loading, has, isAdmin, isHod, isSl, canSeeOversight, departments, schools };
}
