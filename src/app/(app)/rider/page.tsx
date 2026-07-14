import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { DELIVERY_SLA_MINUTES } from "@/lib/constants";
import { markDelivered } from "./actions";

const money = (n: number) => "PKR " + Math.round(Number(n)).toLocaleString("en-PK");

export default async function RiderPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const profile = await requireProfile();
  const { ok, error } = await searchParams;

  if (!profile.branch_id) {
    return (
      <div className="card">
        <h2>Deliveries</h2>
        <p className="meta">Head Office has no branch. Deliveries are handled from a branch/rider login.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("purchases")
    .select("id, total_amount, created_at, customers(name, phone, address)")
    .eq("is_delivery", true)
    .is("delivered_at", null)
    .order("created_at", { ascending: true });

  const now = Date.now();
  const minsAgo = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));

  return (
    <>
      {ok ? <div className="alert ok">Marked as delivered. 🎉</div> : null}
      {error ? <div className="alert err">Could not update — it may already be delivered. Refresh.</div> : null}

      <div className="card">
        <h2>Pending deliveries — {profile.branch_name}</h2>
        {pending && pending.length > 0 ? (
          <p className="meta">{pending.length} order(s) out for delivery.</p>
        ) : (
          <p className="meta">No pending deliveries right now. ✅</p>
        )}
      </div>

      {(pending ?? []).map((p) => {
        const c = p.customers as unknown as { name: string; phone: string; address: string | null } | null;
        const mins = minsAgo(p.created_at as string);
        const late = mins > DELIVERY_SLA_MINUTES;
        return (
          <div className="card" key={p.id as string}>
            <h2>{c?.name ?? "Customer"}</h2>
            <p className="meta">{c?.phone ?? ""}</p>
            {c?.address ? <p className="meta">{c.address}</p> : null}
            <p className="meta">
              {money(p.total_amount as number)} ·{" "}
              <span style={{ color: late ? "var(--danger)" : "var(--muted)", fontWeight: late ? 700 : 400 }}>
                {mins} min ago{late ? " · LATE" : ""}
              </span>
            </p>
            <form action={markDelivered}>
              <input type="hidden" name="purchase_id" value={p.id as string} />
              <button className="btn" type="submit">Mark delivered</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
