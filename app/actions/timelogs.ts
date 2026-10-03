"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { fromManilaInput } from "@/lib/format";
import type { ActionState } from "@/lib/types";

function readTimes(fd: FormData) {
  const rawIn = String(fd.get("time_in") ?? "");
  const rawOut = String(fd.get("time_out") ?? "");
  if (!rawIn) throw new Error("Enter a time in.");
  const time_in = fromManilaInput(rawIn);
  const time_out = rawOut ? fromManilaInput(rawOut) : null;
  if (time_out && new Date(time_out) < new Date(time_in)) {
    throw new Error("Time out must be after time in.");
  }
  return { time_in, time_out };
}

/** Admin override of an existing record. A reason is required and stored with the record. */
export async function overrideTimeLog(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can edit time records." };
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { error: "Enter a reason for the override." };
  try {
    const times = readTimes(fd);
    const supabase = await createClient();
    const { error } = await supabase
      .from("time_logs")
      .update({ ...times, overridden_by: me.id, override_reason: reason })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) return { error: error.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/admin", "layout");
  return { ok: "Record updated." };
}

export async function addManualTimeLog(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can add time records." };
  const studentId = String(fd.get("student_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!studentId) return { error: "Choose a student." };
  if (!reason) return { error: "Enter a reason for the entry." };
  try {
    const times = readTimes(fd);
    if (!times.time_out) return { error: "Enter a time out." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("time_logs")
      .insert({ student_id: studentId, ...times, overridden_by: me.id, override_reason: reason });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/admin", "layout");
  return { ok: "Entry added." };
}

export async function deleteTimeLog(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can delete time records." };
  const supabase = await createClient();
  const { error } = await supabase.from("time_logs").delete().eq("id", String(fd.get("id") ?? ""));
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: "Time record deleted." };
}
