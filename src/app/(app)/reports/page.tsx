import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const money = (n: number) => "PKR " + Math.round(n).toLocaleString("en-PK");
const dateTime = (s: string) =>
  new Date(s).toLocaleString("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

const selectStyle = {
  width: "100%",
  padding: 14,
  fontSize: "1.05rem",
  borderRadius: 10,
  border: "1px solid var(--line)",
} as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  const { branch: branchParam } = await searchParams;
  const supabase = await createClient();

  const { data: totals } = await supabase.rpc("my_sales_totals").single();
  const t = (totals as {
    today_total: number; today_count: number;
    month_total: number; month_count: number;
    all_total: number; all_count: number;
  }) ?? { today_total: 0, today_count: 0, month_total: 0, month_count: 0, all_total: 0, all_count: 0 };

  // Branch list + filter only make sense for head office (a branch sees only its own).
  let branchList: { id: string; name: string }[] = [];
  if (isAdmin) {
    const { data } = await supabase.from("branches").select("id, name").order("name");
    branchList = data ?? [];
  }
  const activeBranch = isAdmin && branchParam ? branchParam : null;
  const activeBranchName = branchList.find((b) => b.id === activeBranch)?.name ?? null;

  let query = supabase
    .from("purchases")
    .select("total_amount, points_earned, created_at, customers(name, phone), branches(name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (activeBranch) query = query.eq("branch_id", activeBranch);
  const { data: recent } = await query;

  return (
    <>
      <div className="card">
        <h2>Sales — {profile.branch_name ?? "All branches"}</h2>
        <div className="stat">
          <div className="box">
            <div className="big">{money(t.today_total)}</div>
            <div className="lbl">Today · {t.today_count} sales</div>
          </div>
          <div className="box">
            <div className="big">{money(t.month_total)}</div>
            <div className="lbl">This month · {t.month_count} sales</div>
          </div>
          <div className="box">
            <div className="big">{money(t.all_total)}</div>
            <div className="lbl">All time · {t.all_count} sales</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Recent purchases{activeBranchName ? ` — ${activeBranchName}` : ""}</h2>

        {isAdmin ? (
          <form method="get" className="row" style={{ alignItems: "flex-end", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="branch">Filter by branch</label>
              <select id="branch" name="branch" defaultValue={activeBranch ?? ""} style={selectStyle}>
                <option value="">All branches</option>
                {branchList.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <button className="btn small" type="submit">Filter</button>
          </form>
        ) : null}

        {recent && recent.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th className="num">Amount</th>
                  <th className="num">Pts</th>
                  <th className="num">Date &amp; time</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => {
                  const cust = r.customers as unknown as { name: string; phone: string } | null;
                  const br = r.branches as unknown as { name: string } | null;
                  return (
                    <tr key={i}>
                      <td>
                        {cust?.name ?? "—"}
                        <div className="meta">{cust?.phone ?? ""}</div>
                      </td>
                      <td>{br?.name ?? "—"}</td>
                      <td className="num">{money(r.total_amount as number)}</td>
                      <td className="num">{r.points_earned as number}</td>
                      <td className="num">{dateTime(r.created_at as string)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta">No purchases{activeBranchName ? ` for ${activeBranchName}` : ""} yet.</p>
        )}
      </div>
    </>
  );
}
