import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { MIN_REDEEM_BALANCE, PKR_PER_POINT_EARNED } from "@/lib/constants";
import {
  createCustomer,
  recordPurchase,
  redeemPoints,
  updateCustomer,
} from "./actions";

type Customer = {
  id: string;
  phone: string;
  name: string;
  address: string | null;
  monthly_medicine: boolean;
};

function OkBanner({ ok }: { ok?: string }) {
  if (!ok) return null;
  const map: Record<string, string> = {
    created: "Customer added.",
    updated: "Customer details updated.",
    recorded: "Purchase recorded — points added.",
    redeemed: "Points redeemed.",
  };
  return <div className="alert ok">{map[ok] ?? "Done."}</div>;
}

function ErrBanner({ error, msg }: { error?: string; msg?: string }) {
  if (!error) return null;
  const map: Record<string, string> = {
    missing: "Please enter at least a phone number and name.",
    consent: "Please tick the consent box to enroll the customer.",
    amount: "Enter a valid purchase amount.",
    phone: "Phone number must be exactly 11 digits.",
    nobranch: "Head Office can't record sales — sign in with a branch login.",
    points: "Enter a valid number of points.",
    save: "Could not save. Check your connection and try again.",
    redeem: msg ?? "Could not redeem points.",
  };
  return <div className="alert err">{map[error] ?? "Something went wrong."}</div>;
}

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{
    phone?: string;
    ok?: string;
    error?: string;
    msg?: string;
  }>;
}) {
  const profile = await requireProfile();
  const canRecord = profile.branch_id !== null; // head office has no branch
  const { phone, ok, error, msg } = await searchParams;
  const query = (phone ?? "").trim();

  let customer: Customer | null = null;
  let balance = 0;
  let searched = false;

  if (query) {
    searched = true;
    const supabase = await createClient();
    const { data: c } = await supabase
      .from("customers")
      .select("id, phone, name, address, monthly_medicine")
      .eq("phone", query)
      .maybeSingle();

    if (c) {
      customer = c as Customer;
      const { data: b } = await supabase
        .from("customer_balances")
        .select("balance")
        .eq("customer_id", c.id)
        .maybeSingle();
      balance = b?.balance ?? 0;
    }
  }

  return (
    <>
      <OkBanner ok={ok} />
      <ErrBanner error={error} msg={msg} />

      {/* Step 1: find the customer by phone (plain GET — no JS needed) */}
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
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </div>

      {/* Step 2a: known customer → record purchase / redeem / edit */}
      {customer ? (
        <>
          <div className="card">
            <h2>{customer.name}</h2>
            <p className="meta">{customer.phone}</p>
            {customer.address ? <p className="meta">{customer.address}</p> : null}
            {customer.monthly_medicine ? (
              <p><span className="tag">Monthly medicine</span></p>
            ) : null}
            <p className="balance">
              {balance} <small>points{balance ? ` · PKR ${balance} value` : ""}</small>
            </p>

            {canRecord ? (
              <form action={recordPurchase}>
                <input type="hidden" name="customer_id" value={customer.id} />
                <input type="hidden" name="phone" value={customer.phone} />
                <label htmlFor="amount">Purchase amount (PKR)</label>
                <input id="amount" name="amount" type="number" min="1" step="1" required />
                <button className="btn" type="submit">
                  Record purchase
                </button>
                <p className="hint">
                  Earns 1 point per PKR {PKR_PER_POINT_EARNED}.
                </p>
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
                  <input
                    id="points"
                    name="points"
                    type="number"
                    min="1"
                    max={balance}
                    step="1"
                    required
                  />
                  <button className="btn secondary" type="submit">
                    Redeem
                  </button>
                </form>
              ) : (
                <p className="meta">
                  Needs at least {MIN_REDEEM_BALANCE} points to redeem (has {balance}).
                </p>
              )}
            </div>
          ) : null}

          <details className="card">
            <summary>Edit name / address</summary>
            <form action={updateCustomer}>
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="phone" value={customer.phone} />
              <label htmlFor="ename">Name</label>
              <input id="ename" name="name" type="text" defaultValue={customer.name} required />
              <label htmlFor="eaddr">Address</label>
              <input
                id="eaddr"
                name="address"
                type="text"
                defaultValue={customer.address ?? ""}
                style={{ textTransform: "uppercase" }}
              />
              <label className="check">
                <input
                  type="checkbox"
                  name="monthly_medicine"
                  defaultChecked={customer.monthly_medicine}
                />
                <span>Monthly medicine customer</span>
              </label>
              <button className="btn secondary" type="submit">
                Save changes
              </button>
            </form>
          </details>
        </>
      ) : null}

      {/* Step 2b: no match → enroll a new customer */}
      {searched && !customer ? (
        <div className="card">
          <h2>New customer</h2>
          <p className="meta">No customer found for {query}. Add them:</p>
          <form action={createCustomer}>
            <input type="hidden" name="phone" value={query} />
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" required autoFocus />
            <label htmlFor="address">Address</label>
            <input id="address" name="address" type="text" style={{ textTransform: "uppercase" }} />
            <label className="check">
              <input type="checkbox" name="monthly_medicine" />
              <span>Monthly medicine customer</span>
            </label>
            <button className="btn" type="submit">
              Add customer
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
