import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { createBranch, provisionBranchLogin } from "./actions";

const money = (n: number) => "PKR " + Math.round(Number(n)).toLocaleString("en-PK");
const dateTime = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; msg?: string }>;
}) {
  await requireAdmin();
  const { ok, error, msg } = await searchParams;
  const supabase = await createClient();

  const { data: branchRows } = await supabase.rpc("branch_sales_all");
  const branches = (branchRows as {
    branch_id: string; branch_name: string; total: number; purchases: number;
  }[]) ?? [];

  const { data: custRows } = await supabase.rpc("customer_sales_summary");
  const customers = (custRows as {
    customer_id: string; name: string; phone: string; visits: number;
    total_spent: number; points: number; last_purchase_at: string | null;
  }[]) ?? [];

  const combined = branches.reduce(
    (a, b) => ({ total: a.total + Number(b.total), count: a.count + Number(b.purchases) }),
    { total: 0, count: 0 },
  );
  const activeCustomers = customers.filter((c) => Number(c.visits) > 0).length;

  return (
    <>
      {ok === "branch" ? <div className="alert ok">Branch added.</div> : null}
      {ok === "login" ? <div className="alert ok">Branch login created.</div> : null}
      {error ? <div className="alert err">{msg ?? "Something went wrong."}</div> : null}

      <div className="card">
        <h2>All-time sales — all branches</h2>
        <div className="stat" style={{ marginBottom: 12 }}>
          <div className="box">
            <div className="big">{money(combined.total)}</div>
            <div className="lbl">Total sales · {combined.count} purchases</div>
          </div>
          <div className="box">
            <div className="big">{customers.length}</div>
            <div className="lbl">Customers · {activeCustomers} with purchases</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th className="num">Purchases</th>
              <th className="num">Total sales</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.branch_id}>
                <td>{b.branch_name}</td>
                <td className="num">{Number(b.purchases)}</td>
                <td className="num">{money(b.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>All customers — sales to date</h2>
        {customers.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
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
                      <div className="meta">{c.phone}</div>
                    </td>
                    <td className="num">{Number(c.visits)}</td>
                    <td className="num">{money(c.total_spent)}</td>
                    <td className="num">{Number(c.points)}</td>
                    <td className="num">{dateTime(c.last_purchase_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta">No customers yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Add branch</h2>
        <form action={createBranch}>
          <label htmlFor="bname">Branch name</label>
          <input id="bname" name="name" type="text" required />
          <label htmlFor="bloc">Location</label>
          <input id="bloc" name="location" type="text" />
          <button className="btn" type="submit">Add branch</button>
        </form>
      </div>

      <div className="card">
        <h2>Create branch login</h2>
        <form action={provisionBranchLogin}>
          <label htmlFor="branch_id">Branch</label>
          <select
            id="branch_id"
            name="branch_id"
            required
            style={{ width: "100%", padding: 14, fontSize: "1.05rem", borderRadius: 10, border: "1px solid var(--line)" }}
          >
            <option value="">Select a branch…</option>
            {branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>
                {b.branch_name}
              </option>
            ))}
          </select>
          <label htmlFor="email">Login email</label>
          <input id="email" name="email" type="email" required />
          <label htmlFor="password">Password (min 8 chars)</label>
          <input id="password" name="password" type="text" minLength={8} required />
          <button className="btn" type="submit">Create login</button>
          <p className="hint">Share these credentials with the branch. One login per branch.</p>
        </form>
      </div>
    </>
  );
}
