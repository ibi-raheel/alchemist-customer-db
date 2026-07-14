import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { MIN_REDEEM_BALANCE, PKR_PER_POINT_EARNED, DELIVERY_SLA_MINUTES } from "@/lib/constants";
import { MonthlyField } from "./MonthlyField";
import {
  createCustomer,
  deletePrescription,
  recordPurchase,
  redeemPoints,
  updateCustomer,
  uploadPrescription,
} from "./actions";

type Customer = {
  id: string;
  phone: string;
  name: string;
  address: string | null;
  monthly_medicine: boolean;
  monthly_invoice_no: string | null;
  remark: string | null;
  prescription_path: string | null;
};

const money = (n: number) => "PKR " + Math.round(Number(n)).toLocaleString("en-PK");

function OkBanner({ ok }: { ok?: string }) {
  if (!ok) return null;
  const map: Record<string, string> = {
    created: "Customer added.",
    updated: "Customer details updated.",
    recorded: "Purchase recorded — points added.",
    redeemed: "Points redeemed.",
    prescription: "Prescription uploaded.",
    prescription_deleted: "Prescription deleted.",
  };
  return <div className="alert ok">{map[ok] ?? "Done."}</div>;
}

function ErrBanner({ error, msg }: { error?: string; msg?: string }) {
  if (!error) return null;
  const map: Record<string, string> = {
    missing: "Please enter phone, name and address.",
    amount: "Enter a valid purchase amount.",
    phone: "Phone number must be exactly 11 digits.",
    nobranch: "Head Office can't record sales — sign in with a branch login.",
    points: "Enter a valid number of points.",
    file: "Please choose a file to upload.",
    save: "Could not save. Check your connection and try again.",
    redeem: msg ?? "Could not redeem points.",
  };
  return <div className="alert err">{map[error] ?? "Something went wrong."}</div>;
}

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; ok?: string; error?: string; msg?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role === "rider") redirect("/rider");
  const canRecord = profile.branch_id !== null; // head office has no branch
  const { phone, ok, error, msg } = await searchParams;
  const query = (phone ?? "").trim();

  let customer: Customer | null = null;
  let balance = 0;
  let totalSpent = 0;
  let visits = 0;
  let prescriptionUrl: string | null = null;
  let searched = false;

  if (query) {
    searched = true;
    const supabase = await createClient();
    const { data: c } = await supabase
      .from("customers")
      .select("id, phone, name, address, monthly_medicine, monthly_invoice_no, remark, prescription_path")
      .eq("phone", query)
      .maybeSingle();

    if (c) {
      customer = c as Customer;
      const [{ data: b }, { data: stats }] = await Promise.all([
        supabase.from("customer_balances").select("balance").eq("customer_id", c.id).maybeSingle(),
        supabase.rpc("customer_stats", { p_customer: c.id }).single(),
      ]);
      balance = b?.balance ?? 0;
      const s = stats as { total_spent: number; visits: number } | null;
      totalSpent = Number(s?.total_spent ?? 0);
      visits = Number(s?.visits ?? 0);

      if (customer.prescription_path) {
        const admin = createAdminClient();
        const { data: signed } = await admin.storage
          .from("prescriptions")
          .createSignedUrl(customer.prescription_path, 3600);
        prescriptionUrl = signed?.signedUrl ?? null;
      }
    }
  }

  return (
    <>
      <OkBanner ok={ok} />
      <ErrBanner error={error} msg={msg} />

      {/* Step 1: find the customer by phone (plain GET) */}
      <div className="card">
        <h2>Find customer</h2>
        <form action="/" method="get">
          <label htmlFor="phone">Phone number</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]{11}"
            maxLength={11}
            required
            autoFocus
            defaultValue={query}
            placeholder="03001234567"
            title="Enter the 11-digit phone number, digits only"
          />
          <button className="btn" type="submit">Search</button>
        </form>
      </div>

      {/* Step 2a: known customer */}
      {customer ? (
        <>
          <div className="card">
            <h2>{customer.name}</h2>
            <p className="meta">{customer.phone}</p>
            {customer.address ? <p className="meta">{customer.address}</p> : null}
            {customer.monthly_medicine ? (
              <p>
                <span className="tag">Monthly medicine</span>
                {customer.monthly_invoice_no ? (
                  <span className="meta"> · Invoice {customer.monthly_invoice_no}</span>
                ) : null}
              </p>
            ) : null}
            {customer.remark ? <p className="meta">📝 {customer.remark}</p> : null}

            <div className="stat" style={{ margin: "12px 0" }}>
              <div className="box">
                <div className="big">{balance}</div>
                <div className="lbl">points{balance ? ` · PKR ${balance} value` : ""}</div>
              </div>
              <div className="box">
                <div className="big">{money(totalSpent)}</div>
                <div className="lbl">total spent · {visits} visits</div>
              </div>
            </div>

            {prescriptionUrl ? (
              <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a className="btn small secondary" href={prescriptionUrl} target="_blank" rel="noopener noreferrer">View prescription</a>
                <form action={deletePrescription}>
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <input type="hidden" name="phone" value={customer.phone} />
                  <input type="hidden" name="path" value={customer.prescription_path ?? ""} />
                  <button className="btn small" type="submit" style={{ background: "var(--danger)" }}>
                    Delete
                  </button>
                </form>
              </p>
            ) : null}

            {canRecord ? (
              <form action={recordPurchase}>
                <input type="hidden" name="customer_id" value={customer.id} />
                <input type="hidden" name="phone" value={customer.phone} />
                <label htmlFor="amount">Purchase amount (PKR)</label>
                <input id="amount" name="amount" type="number" min="1" step="1" required />
                <label className="check">
                  <input type="checkbox" name="is_delivery" />
                  <span>Delivery order (starts the {DELIVERY_SLA_MINUTES}-min timer)</span>
                </label>
                <button className="btn" type="submit">Record purchase</button>
                <p className="hint">Earns 1 point per PKR {PKR_PER_POINT_EARNED}.</p>
              </form>
            ) : (
              <div
                className="alert"
                style={{ background: "var(--primary-tint)", color: "var(--primary-dark)", border: "1px solid #cfe0f8" }}
              >
                You&apos;re signed in as <strong>Head Office</strong>. Recording sales and
                redeeming points is done from a <strong>branch login</strong>.
              </div>
            )}
          </div>

          {canRecord ? (
            <div className="card">
              <h2>Redeem points</h2>
              {balance >= MIN_REDEEM_BALANCE ? (
                <form action={redeemPoints}>
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <input type="hidden" name="phone" value={customer.phone} />
                  <label htmlFor="points">Points to redeem (1 point = PKR 1)</label>
                  <input id="points" name="points" type="number" min="1" max={balance} step="1" required />
                  <button className="btn secondary" type="submit">Redeem</button>
                </form>
              ) : (
                <p className="meta">Needs at least {MIN_REDEEM_BALANCE} points to redeem (has {balance}).</p>
              )}
            </div>
          ) : null}

          <details className="card">
            <summary>Edit details</summary>
            <form action={updateCustomer}>
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="phone" value={customer.phone} />
              <label htmlFor="ename">Name</label>
              <input id="ename" name="name" type="text" defaultValue={customer.name} required />
              <label htmlFor="eaddr">Address</label>
              <input id="eaddr" name="address" type="text" defaultValue={customer.address ?? ""} required style={{ textTransform: "uppercase" }} />
              <MonthlyField defaultChecked={customer.monthly_medicine} defaultInvoice={customer.monthly_invoice_no ?? ""} />
              <label htmlFor="eremark">Remark</label>
              <input id="eremark" name="remark" type="text" defaultValue={customer.remark ?? ""} />
              <button className="btn secondary" type="submit">Save changes</button>
            </form>
          </details>

          <details className="card">
            <summary>Upload prescription</summary>
            <form action={uploadPrescription} encType="multipart/form-data">
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="phone" value={customer.phone} />
              <label htmlFor="rx">Prescription (photo or PDF)</label>
              <input id="rx" name="prescription" type="file" accept="image/*,application/pdf" required />
              <button className="btn secondary" type="submit">Upload</button>
            </form>
          </details>
        </>
      ) : null}

      {/* Step 2b: no match → enroll a new customer */}
      {searched && !customer ? (
        <div className="card">
          <h2>New customer</h2>
          <p className="meta">No customer found for {query}. Add them:</p>
          <form action={createCustomer} encType="multipart/form-data">
            <input type="hidden" name="phone" value={query} />
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" required autoFocus />
            <label htmlFor="address">Address</label>
            <input id="address" name="address" type="text" required style={{ textTransform: "uppercase" }} />
            <MonthlyField />
            <label htmlFor="remark">Remark</label>
            <input id="remark" name="remark" type="text" />
            <label htmlFor="prescription">Prescription (optional — photo or PDF)</label>
            <input id="prescription" name="prescription" type="file" accept="image/*,application/pdf" />
            <button className="btn" type="submit">Add customer</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
