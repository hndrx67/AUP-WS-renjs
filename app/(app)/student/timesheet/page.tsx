import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Empty, PageHeader, Panel, TableWrap } from "@/components/ui";
import { fmtDate, fmtHours, fmtTime } from "@/lib/format";
import { logHours } from "@/lib/stats";
import type { TimeLog } from "@/lib/types";

export const metadata = { title: "Time records" };

export default async function Timesheet() {
  const me = await requireRole("student");
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_logs").select("*").eq("student_id", me.id)
    .order("time_in", { ascending: false }).limit(300);
  const logs = (data ?? []) as TimeLog[];

  return (
    <>
      <PageHeader title="Time records" description="Your 300 most recent time in and time out records." />
      <Panel>
        {logs.length === 0 ? <Empty>No records yet.</Empty> : (
          <TableWrap>
            <thead><tr><th className="th">Date</th><th className="th">Time in</th><th className="th">Time out</th><th className="th">Hours</th><th className="th">Notes</th></tr></thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="td">{fmtDate(l.time_in)}</td>
                  <td className="td">{fmtTime(l.time_in)}</td>
                  <td className="td">{l.time_out ? fmtTime(l.time_out) : <Badge tone="success">In progress</Badge>}</td>
                  <td className="td">{l.time_out ? fmtHours(logHours(l)) : "-"}</td>
                  <td className="td">
                    {l.override_reason ? <Badge tone="warning">Adjusted: {l.override_reason}</Badge> : <span className="text-muted-foreground">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
