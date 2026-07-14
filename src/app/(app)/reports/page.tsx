import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { DELIVERY_SLA_MINUTES } from "@/lib/constants";

const money = (n: number) => "PKR " + Math.round(n).toLocaleString("en-PK");
const avg = (total: number, count: number) => (count > 0 ? total / count : 0);
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

  const { data: dstats } = await supabase.rpc("delivery_stats").single();
  const ds = (dstats as {
    pending: number; delivered: number; avg_minutes: number | null; ontime_pct: number | null;
  }) ?? { pending: 0, delivered: 0, avg_minutes: null, ontime_pct: null };

  // Head-office-only, org-wide sections (moved here from the Admin page).
  let branchTable: { branch_id: string; branch_name: string; total: number; purchases: number }[] = [];
  let customers: {
    customer_id: string; name: string; phone: string; visits: number;
    total_spent: number; points: number; last_purchase_at: string | null; monthly_medicine: boolean;
  }[] = [];
  let branchList: { id: string; name: string }[] = [];
  if (isAdmin) {
    const [{ data: b }, { data: c }, { data: bl }] = await Promise.all([
      supabase.rpc("branch_sales_all"),
      supabase.rpc("customer_sales_summary"),
      supabase.from("branches").select("id, name").order("name"),
    ]);
    branchTable = (b as typeof branchTable) ?? [];
    customers = (c as typeof customers) ?? [];
    branchList = bl ?? [];
  }
  const combined = branchTable.reduce(
    (a, x) => ({ total: a.total + Number(x.total), count: a.count + Number(x.purchases) }),
    { total: 0, count: 0 },
  );

  const activeBranch = isAdmin && branchParam ? branchParam : null;
  const activeBranchName = branchList.find((x) => x.id === activeBranch)?.name ?? null;

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
          <div className="box">
            <div className="big">{money(avg(t.all_total, t.all_count))}</div>
            <div className="lbl">Avg invoice</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Deliveries — {profile.branch_name ?? "All branches"}</h2>
        <div className="stat">
          <div className="box">
            <div className="big">{Number(ds.pending)}</div>
            <div className="lbl">Pending now</div>
          </div>
          <div className="box">
            <div className="big">{Number(ds.delivered)}</div>
            <div className="lbl">Delivered</div>
          </div>
          <div className="box">
            <div className="big">{ds.avg_minutes != null ? `${ds.avg_minutes} min` : "—"}</div>
            <div className="lbl">Avg delivery time</div>
          </div>
          <div className="box">
            <div className="big">{ds.ontime_pct != null ? `${ds.ontime_pct}%` : "—"}</div>
            <div className="lbl">Within {DELIVERY_SLA_MINUTES} min</div>
          </div>
        </div>
      </div>

      {isAdmin ? (
        <>
          <div className="card">
            <h2>All-time sales — all branches</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th className="num">Purchases</th>
                    <th className="num">Total sales</th>
                    <th className="num">Avg invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {branchTable.map((b) => (
                    <tr key={b.branch_id}>
                      <td>{b.branch_name}</td>
                      <td className="num">{Number(b.purchases)}</td>
                      <td className="num">{money(b.total)}</td>
                      <td className="num">{money(avg(Number(b.total), Number(b.purchases)))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>All branches</strong></td>
                    <td className="num"><strong>{combined.count}</strong></td>
                    <td className="num"><strong>{money(combined.total)}</strong></td>
                    <td className="num"><strong>{money(avg(combined.total, combined.count))}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>All customers — sales to date</h2>
            {customers.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="num">Visits</th>
                      <th className="num">Total spent</th>
                      <th className="num">Points</th>
                      <th className="num">Last visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.customer_id}>
                        <td>
                          {c.name}
                          {c.monthly_medicine ? <span className="tag" style={{ marginLeft: 6 }}>Monthly</span> : null}
                          <div className="meta">{c.phone}</div>
                        </td>
                        <td className="num">{Number(c.visits)}</td>
                        <td className="num">{money(c.total_spent)}</td>
                        <td className="num">{Number(c.points)}</td>
                        <td className="num">{c.last_purchase_at ? dateTime(c.last_purchase_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="meta">No customers yet.</p>
            )}
          </div>
        </>
      ) : null}

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
          <div className="table-scroll">
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
