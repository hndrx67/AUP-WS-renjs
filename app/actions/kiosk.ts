"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createKioskAvatarToken } from "@/lib/profile-storage";

export type KioskState = {
  error?: string;
  result?: {
    studentProfileId: string;
    studentName: string;
    studentNumber: string;
    action: "clocked_in" | "clocked_out";
    timeIn: string;
    timeOut: string | null;
    avatarUrl: string | null;
  };
} | null;

/** Kiosk scans usually type the card number into the focused field and press Enter. */
export async function toggleKioskTime(_prev: KioskState, formData: FormData): Promise<KioskState> {
  const studentNumber = String(formData.get("student_id") ?? "").trim();
  if (!studentNumber) return { error: "Enter or scan a student ID." };
  if (studentNumber.length > 100) return { error: "That student ID is too long." };

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("kiosk_toggle_time", { p_student_id: studentNumber });
  if (error) {
    if (error.message.includes("Student ID is not unique")) {
      return { error: "This student ID is assigned to multiple accounts. Contact an administrator." };
    }
    if (error.message.includes("No active student found")) {
      return { error: "No active work scholar was found for that ID. Check the number and try again." };
    }
    return { error: "Could not record your time right now. Please try again or contact staff." };
  }
  if (!data?.length) {
    return { error: "Could not record your time right now. Please try again or contact staff." };
  }

  const row = data[0] as {
    student_name: string;
    student_number: string;
    action: "clocked_in" | "clocked_out";
    time_in: string;
    time_out: string | null;
  };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, avatar_path")
    .eq("student_id", studentNumber)
    .eq("role", "student")
    .eq("is_active", true)
    .maybeSingle();
  let avatarUrl: string | null = null;
  if (profile?.avatar_path) {
    const { expires, token } = createKioskAvatarToken(profile.id, profile.avatar_path);
    avatarUrl = `/profile-image/${profile.id}/avatar?expires=${expires}&token=${encodeURIComponent(token)}`;
  }

  return {
    result: {
      studentProfileId: profile?.id ?? "",
      studentName: row.student_name,
      studentNumber: row.student_number,
      action: row.action,
      timeIn: row.time_in,
      timeOut: row.time_out,
      avatarUrl,
    },
  };
}
