import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { createBranch, provisionBranchLogin } from "./actions";

const selectStyle = {
  width: "100%",
  padding: 14,
  fontSize: "1.05rem",
  borderRadius: 10,
  border: "1px solid var(--line)",
} as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; msg?: string }>;
}) {
  await requireAdmin();
  const { ok, error, msg } = await searchParams;
  const supabase = await createClient();

  const [{ data: branchRows }, { data: loginRows }] = await Promise.all([
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("branch_logins").select("branch_id, email"),
  ]);
  const branches = branchRows ?? [];
  const logins = new Map(
    (loginRows ?? []).map((c) => [c.branch_id as string, c.email as string]),
  );

  return (
    <>
      {ok === "branch" ? <div className="alert ok">Branch added.</div> : null}
      {ok === "login" ? <div className="alert ok">Branch login created.</div> : null}
      {error ? <div className="alert err">{msg ?? "Something went wrong."}</div> : null}

      <div className="card">
        <h2>Branch logins</h2>
        <p className="meta" style={{ marginTop: 0 }}>
          Which login email each branch uses. Only head office can see this.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Login email</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{logins.get(b.id) ?? <span className="meta">— no login yet —</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Passwords are never shown (they&apos;re stored securely). If a branch forgets
          its password, create its login again below to set a new one.
        </p>
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
          <select id="branch_id" name="branch_id" required style={selectStyle}>
            <option value="">Select a branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <label htmlFor="email">Login email</label>
          <input id="email" name="email" type="email" required />
          <label htmlFor="password">Password (min 8 chars)</label>
          <input id="password" name="password" type="text" minLength={8} required />
          <button className="btn" type="submit">Create login</button>
          <p className="hint">
            Creating a login for a branch that already has one will replace its password.
          </p>
        </form>
      </div>
    </>
  );
}
