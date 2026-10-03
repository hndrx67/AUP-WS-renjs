import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ScheduleManager } from "@/components/schedule-manager";

export const metadata = { title: "Schedules" };

export default async function SchedulesPage() {
  await requireRole("supervisor");
  const supabase = await createClient();
  const [{ data: students }, { data: schedules }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "student").eq("is_active", true).order("full_name"),
    supabase.from("schedules").select("*, student:profiles(full_name)").order("day_of_week").order("start_time"),
  ]);
  return (
    <>
      <PageHeader title="Schedules" description="Set the weekly shifts for work scholars in your department." />
      <ScheduleManager students={students ?? []} schedules={(schedules ?? []) as never} />
    </>
  );
}
