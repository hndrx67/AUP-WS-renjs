"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile } from "@/lib/auth";
import type { ActionState, Role } from "@/lib/types";

type NewAccount = {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  department_id: string | null;
  student_id: string | null;
  work_assignment: string | null;
  hourly_rate: number;
};

async function createAccount(a: NewAccount): Promise<ActionState> {
  if (!a.full_name) return { error: "Enter the full name." };
  if (!/^\S+@\S+\.\S+$/.test(a.email)) return { error: "Enter a valid email address." };
  if (a.password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!(a.hourly_rate >= 0)) return { error: "Hourly rate must be zero or more." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: a.email,
    password: a.password,
    email_confirm: true,
    user_metadata: { full_name: a.full_name },
  });
  if (error || !data.user) return { error: error?.message ?? "Could not create the account." };

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: a.full_name,
      role: a.role,
      department_id: a.department_id,
      student_id: a.student_id,
      work_assignment: a.work_assignment,
      hourly_rate: a.hourly_rate,
    })
    .eq("id", data.user.id);

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: profileError.message };
  }
  return { ok: `Created ${a.full_name}.` };
}

function readAccount(fd: FormData) {
  return {
    email: String(fd.get("email") ?? "").trim().toLowerCase(),
    password: String(fd.get("password") ?? ""),
    full_name: String(fd.get("full_name") ?? "").trim(),
    student_id: String(fd.get("student_id") ?? "").trim() || null,
    work_assignment: String(fd.get("work_assignment") ?? "").trim() || null,
    hourly_rate: Number(fd.get("hourly_rate") ?? 0) || 0,
  };
}

/** Supervisors create work scholar accounts inside their own department only. */
export async function createStudentAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "supervisor") return { error: "Only active supervisors can create student accounts." };
  if (!me.department_id) {
    return { error: "You are not assigned to a department yet. Ask an administrator." };
  }
  const result = await createAccount({
    ...readAccount(fd),
    role: "student",
    department_id: me.department_id,
  });
  revalidatePath("/supervisor", "layout");
  return result;
}

/** Administrators create any kind of account. */
export async function createUserAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can create accounts." };
  const role = String(fd.get("role") ?? "student") as Role;
  if (!["student", "supervisor", "admin"].includes(role)) return { error: "Choose a role." };
  const departmentId = String(fd.get("department_id") ?? "") || null;
  const result = await createAccount({
    ...readAccount(fd),
    role,
    department_id: role === "admin" ? null : departmentId,
  });
  revalidatePath("/admin", "layout");
  return result;
}

/** Admin override: move a user to another department and/or change a student's hourly rate. */
export async function updateUserAssignment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can edit account assignments." };
  const userId = String(fd.get("user_id") ?? "");
  const departmentId = String(fd.get("department_id") ?? "") || null;
  const update: Record<string, unknown> = { department_id: departmentId };
  const rate = fd.get("hourly_rate");
  if (rate !== null && String(rate) !== "") update.hourly_rate = Math.max(0, Number(rate) || 0);
  if (fd.has("work_assignment")) update.work_assignment = String(fd.get("work_assignment") ?? "").trim() || null;
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: "Student assignment updated." };
}

export async function setUserActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can change account status." };
  const userId = String(fd.get("user_id") ?? "");
  if (userId === me.id) return { error: "You cannot deactivate your own account." };
  const active = String(fd.get("active")) === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: active ? "Account reactivated." : "Account deactivated." };
}

/** Supervisors can edit scholars in their own department and disable them. */
export async function updateDepartmentStudent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "supervisor" || !me.department_id) return { error: "Only active supervisors can edit department students." };
  const userId = String(fd.get("user_id") ?? "");
  const supabase = await createClient();
  const { data: student } = await supabase
    .from("profiles")
    .select("id, role, department_id")
    .eq("id", userId)
    .single();
  if (student?.role !== "student" || student.department_id !== me.department_id) return { error: "That student is not in your department." };

  const update: Record<string, unknown> = {};
  if (fd.has("student_id")) update.student_id = String(fd.get("student_id") ?? "").trim() || null;
  if (fd.has("work_assignment")) update.work_assignment = String(fd.get("work_assignment") ?? "").trim() || null;
  if (fd.has("hourly_rate")) {
    const rate = Number(fd.get("hourly_rate"));
    if (Number.isFinite(rate) && rate >= 0) update.hourly_rate = rate;
  }
  if (String(fd.get("disable") ?? "") === "true") update.is_active = false;
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/supervisor/students");
  revalidatePath("/supervisor/department");
  return { ok: update.is_active === false ? "Student account disabled." : "Student entry saved." };
}

/** Only administrators can permanently remove an account. */
export async function deleteUserAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can delete accounts." };
  const userId = String(fd.get("user_id") ?? "");
  if (!userId || userId === me.id) return { error: "You cannot delete your own account." };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: "Account permanently deleted." };
}

/** Administrators can override the auth email and/or password for any account. */
export async function updateAccountCredentials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getSessionProfile();
  if (!me?.is_active || me.role !== "admin") return { error: "Only active administrators can change account credentials." };
  const userId = String(fd.get("user_id") ?? "");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const confirmation = String(fd.get("password_confirmation") ?? "");
  if (!userId) return { error: "Choose an account." };
  if (!email && !password) return { error: "Enter a new email address or password." };
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  if (password && password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirmation) return { error: "The passwords do not match." };

  const admin = createAdminClient();
  const attributes: { email?: string; email_confirm?: boolean; password?: string } = {};
  if (email) {
    attributes.email = email;
    attributes.email_confirm = true;
  }
  if (password) attributes.password = password;
  const { error } = await admin.auth.admin.updateUserById(userId, attributes);
  if (error) return { error: error.message };

  if (email) {
    const { error: profileError } = await admin.from("profiles").update({ email }).eq("id", userId);
    if (profileError) return { error: "Auth credentials changed, but the profile email could not be synchronized." };
  }
  revalidatePath("/admin", "layout");
  return { ok: email && password ? "Account email and password updated." : email ? "Account email updated." : "Account password updated." };
}
