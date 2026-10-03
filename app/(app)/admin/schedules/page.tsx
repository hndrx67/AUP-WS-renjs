import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ScheduleManager } from "@/components/schedule-manager";

export const metadata = { title: "Schedules" };

export default async function AdminSchedules() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: students }, { data: schedules }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "student").eq("is_active", true).order("full_name"),
    supabase.from("schedules").select("*, student:profiles(full_name)").order("day_of_week").order("start_time"),
  ]);
  return (
    <>
      <PageHeader title="Schedules" description="Weekly shifts for every work scholar." />
      <ScheduleManager students={students ?? []} schedules={(schedules ?? []) as never} />
    </>
  );
}
