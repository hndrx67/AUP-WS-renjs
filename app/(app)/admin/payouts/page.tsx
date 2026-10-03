import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FinanceManager } from "@/components/finance-manager";
import { PageHeader } from "@/components/ui";
import { summarizeStudentFinance } from "@/lib/finance";
import type { Payout, Profile, TimeLog, WalletTransfer } from "@/lib/types";

export const metadata = { title: "Finances" };

export default async function AdminFinancesPage() {
  await requireAdmin();
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
      <PageHeader title="Student finances" description="Work earnings reduce school tuition first. Tuition credit can be allocated to a personal wallet for withdrawal." />
      <FinanceManager rows={rows} transfers={T} payouts={P} canDelete />
    </>
  );
}
