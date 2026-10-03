import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Calendar } from "@/components/calendar";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const me = await requireRole("student");
  const supabase = await createClient();
  const since = new Date(Date.now() - 400 * 864e5).toISOString();
  const [{ data: shifts }, { data: logs }] = await Promise.all([
    supabase.from("schedules").select("*").eq("student_id", me.id),
    supabase.from("time_logs").select("id,time_in,time_out").eq("student_id", me.id).gte("time_in", since),
  ]);

  return (
    <>
      <PageHeader title="Schedule" description="Your weekly shifts alongside the time you recorded. Select a day for details." />
      <Calendar shifts={shifts ?? []} logs={logs ?? []} />
    </>
  );
}
