import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProfileWithDept, Role } from "./types";

export const homeFor = (role: Role) => `/${role}`;

export async function getSessionProfile(): Promise<ProfileWithDept | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*, department:departments(id, name)")
    .eq("id", user.id)
    .single();
  return (data as ProfileWithDept | null) ?? null;
}

export async function requireRole(role: Role): Promise<ProfileWithDept> {
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active) redirect("/login");
  if (profile.role !== role) redirect(homeFor(profile.role));
  return profile;
}

export const requireAdmin = () => requireRole("admin");
