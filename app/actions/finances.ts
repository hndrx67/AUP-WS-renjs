"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

function inputAmount(fd: FormData) {
  const amount = Number(fd.get("amount"));
  return Number.isFinite(amount) ? amount : Number.NaN;
}

async function authorizedManager() {
  const me = await getSessionProfile();
  if (!me?.is_active || (me.role !== "admin" && me.role !== "supervisor")) return null;
  return me;
}

function refreshFinancePages() {
  revalidatePath("/admin/payouts");
  revalidatePath("/supervisor/finances");
  revalidatePath("/student");
  revalidatePath("/student/earnings");
}

export async function setSchoolTuitionBalance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await authorizedManager();
  if (!me) return { error: "Only active administrators and supervisors can manage student finances." };
  const studentId = String(fd.get("student_id") ?? "");
  const amount = inputAmount(fd);
  if (!studentId) return { error: "Choose a student." };
  if (!Number.isFinite(amount) || amount < 0) return { error: "Enter a tuition balance of zero or more." };

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_student_tuition_balance", {
    p_student_id: studentId,
    p_amount: amount,
    p_actor_id: me.id,
  });
  if (error) return { error: error.message };
  refreshFinancePages();
  return { ok: "School tuition balance updated." };
}

export async function allocateToPersonalWallet(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await authorizedManager();
  if (!me) return { error: "Only active administrators and supervisors can manage student finances." };
  const studentId = String(fd.get("student_id") ?? "");
  const amount = inputAmount(fd);
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!studentId) return { error: "Choose a student." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };

  const admin = createAdminClient();
  const { error } = await admin.rpc("allocate_student_wallet", {
    p_student_id: studentId,
    p_amount: amount,
    p_note: note,
    p_actor_id: me.id,
  });
  if (error) return { error: error.message };
  refreshFinancePages();
  return { ok: "Earned money allocated to the personal wallet." };
}

export async function recordStudentWithdrawal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await authorizedManager();
  if (!me) return { error: "Only active administrators and supervisors can record a withdrawal." };
  const studentId = String(fd.get("student_id") ?? "");
  const amount = inputAmount(fd);
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!studentId) return { error: "Choose a student." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_student_withdrawal", {
    p_student_id: studentId,
    p_amount: amount,
    p_note: note,
    p_actor_id: me.id,
  });
  if (error) return { error: error.message };
  refreshFinancePages();
  return { ok: "Personal wallet withdrawal recorded." };
}

export async function deleteStudentWithdrawal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can delete withdrawals." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_student_withdrawal", {
    p_payout_id: String(fd.get("id") ?? ""),
    p_actor_id: me.id,
  });
  if (error) return { error: error.message };
  refreshFinancePages();
  return { ok: "Withdrawal record deleted." };
}
