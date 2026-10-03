"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

export async function createDepartment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can create departments." };
  const name = String(fd.get("name") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim() || null;
  if (!name) return { error: "Enter a department name." };

  const supabase = await createClient();
  const { error } = await supabase.from("departments").insert({ name, description });
  if (error) {
    return { error: error.code === "23505" ? "A department with that name already exists." : error.message };
  }
  revalidatePath("/admin", "layout");
  return { ok: `Created ${name}.` };
}

export async function deleteDepartment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can delete departments." };
  const supabase = await createClient();
  // Members are kept and become unassigned (on delete set null).
  const { error } = await supabase.from("departments").delete().eq("id", String(fd.get("id") ?? ""));
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: "Department deleted." };
}
