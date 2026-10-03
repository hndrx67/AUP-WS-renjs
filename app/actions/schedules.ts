"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

export async function addSchedule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || (me.role !== "supervisor" && me.role !== "admin")) {
    return { error: "Only supervisors and administrators can do this." };
  }
  const student_id = String(fd.get("student_id") ?? "");
  const day_of_week = Number(fd.get("day_of_week"));
  const start_time = String(fd.get("start_time") ?? "");
  const end_time = String(fd.get("end_time") ?? "");
  const label = String(fd.get("label") ?? "").trim() || null;

  if (!student_id) return { error: "Choose a student." };
  if (!(day_of_week >= 0 && day_of_week <= 6)) return { error: "Choose a day." };
  if (!start_time || !end_time) return { error: "Enter a start and end time." };
  if (end_time <= start_time) return { error: "End time must be after start time." };

  const supabase = await createClient();
  // RLS limits supervisors to students in their own department.
  const { error } = await supabase
    .from("schedules")
    .insert({ student_id, day_of_week, start_time, end_time, label });
  if (error) return { error: "You can only schedule students in your department." };
  revalidatePath("/", "layout");
  return { ok: "Shift added." };
}

export async function deleteSchedule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || (me.role !== "supervisor" && me.role !== "admin")) return { error: "Only active supervisors and administrators can remove shifts." };
  const supabase = await createClient();
  const { error } = await supabase.from("schedules").delete().eq("id", String(fd.get("id") ?? ""));
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Shift removed." };
}
