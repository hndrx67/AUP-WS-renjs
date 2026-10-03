import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FinanceManager } from "@/components/finance-manager";
import { PageHeader } from "@/components/ui";
import { summarizeStudentFinance } from "@/lib/finance";
import type { Payout, Profile, TimeLog, WalletTransfer } from "@/lib/types";

export const metadata = { title: "Student finances" };

export default async function SupervisorFinancesPage() {
  const me = await requireRole("supervisor");
  const supabase = await createClient();
  const [{ data: students }, { data: logs }, { data: transfers }, { data: payouts }] = await Promise.all([
    supabase.from("profiles").select("*").eq("role", "student").order("full_name"),
    supabase.from("time_logs").select("*"),
    supabase.from("wallet_transfers").select("*"),
    supabase.from("payouts").select("*").order("paid_at", { ascending: false }),
  ]);
  const S = (students ?? []) as Profile[];
  const L = (logs ?? []) as TimeLog[];
  const T = (transfers ?? []) as WalletTransfer[];
  const P = (payouts ?? []) as Payout[];
  const rows = S.map((student) => ({
    student,
    ...summarizeStudentFinance(student, L, T, P),
  }));

  return (
    <>
      <PageHeader title="Student finances" description={me.department ? `Set tuition balances and manage the personal wallet for ${me.department.name}.` : "You are not assigned to a department."} />
      <FinanceManager rows={rows} transfers={T} payouts={P} />
    </>
  );
}
