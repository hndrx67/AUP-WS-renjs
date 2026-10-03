"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

export async function clockIn(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "student") return { error: "Only active work scholars can clock in." };
  const supabase = await createClient();
  // time_in is set by the database so it cannot be backdated.
  const { error } = await supabase.from("time_logs").insert({ student_id: me.id });
  if (error) return { error: error.code === "23505" ? "You are already clocked in." : error.message };
  revalidatePath("/student", "layout");
  return { ok: "Time in recorded." };
}

export async function clockOut(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "student") return { error: "Only active work scholars can clock out." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_logs")
    .update({ time_out: new Date().toISOString() })
    .eq("student_id", me.id)
    .is("time_out", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You are not currently clocked in." };
  revalidatePath("/student", "layout");
  return { ok: "Time out recorded." };
}
