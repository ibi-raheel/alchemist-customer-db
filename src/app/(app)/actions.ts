"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Digits only — Pakistani mobile numbers are 11 digits (e.g. 03001234567).
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}
const PHONE_LENGTH = 11;

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Create a new customer (loyalty enrollment) with consent, then show them.
export async function createCustomer(formData: FormData) {
  const profile = await requireProfile();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim().toUpperCase();
  const monthly = formData.get("monthly_medicine") === "on";

  if (!phone || !name) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=missing`);
  }
  if (phone.length !== PHONE_LENGTH) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=phone`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    phone,
    name,
    address: address || null,
    monthly_medicine: monthly,
    created_by_branch: profile.branch_id,
  });

  if (error) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);
  }
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=created`);
}

// Update an existing customer's name/address (any branch may fix these).
export async function updateCustomer(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim().toUpperCase();
  const monthly = formData.get("monthly_medicine") === "on";
  if (!id || !name) redirect(`/?phone=${encodeURIComponent(phone)}&error=missing`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ name, address: address || null, monthly_medicine: monthly })
    .eq("id", id);

  if (error) redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=updated`);
}

// Record a purchase; the DB trigger awards loyalty points automatically.
export async function recordPurchase(formData: FormData) {
  const profile = await requireProfile();
  const customerId = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const amount = Number(formData.get("amount"));

  if (!customerId || !Number.isFinite(amount) || amount <= 0) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=amount`);
  }
  if (!profile.branch_id) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=nobranch`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("purchases").insert({
    customer_id: customerId,
    branch_id: profile.branch_id,
    total_amount: amount,
  });

  if (error) redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);
  revalidatePath("/");
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=recorded`);
}

// Redeem loyalty points via the DB function (enforces min-100 + no-negative).
export async function redeemPoints(formData: FormData) {
  await requireProfile();
  const customerId = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const points = Number(formData.get("points"));

  if (!customerId || !Number.isInteger(points) || points <= 0) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=points`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_points", {
    p_customer: customerId,
    p_points: points,
  });

  if (error) {
    redirect(
      `/?phone=${encodeURIComponent(phone)}&error=redeem&msg=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=redeemed`);
}
