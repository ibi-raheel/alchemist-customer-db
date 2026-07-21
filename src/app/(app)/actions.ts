"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";

// Digits only — Pakistani mobile numbers are 11 digits (e.g. 03001234567).
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}
const PHONE_LENGTH = 11;

// Uploads a prescription file to the private 'prescriptions' bucket (server-side,
// service role). Returns the stored path, or null on failure.
async function uploadPrescriptionFile(customerId: string, file: File): Promise<string | null> {
  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${customerId}/${Date.now()}.${ext}`;
  const { error } = await admin.storage.from("prescriptions").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  return error ? null : path;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Create a new customer. Phone, name and address are all required.
export async function createCustomer(formData: FormData) {
  const profile = await requireProfile();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const name = String(formData.get("name") ?? "").trim().toUpperCase();
  const address = String(formData.get("address") ?? "").trim().toUpperCase();
  const monthly = formData.get("monthly_medicine") === "on";
  const invoiceNo = String(formData.get("monthly_invoice_no") ?? "").trim();
  const remark = String(formData.get("remark") ?? "").trim();
  const file = formData.get("prescription") as File | null;

  if (!phone || !name || !address) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=missing`);
  }
  if (phone.length !== PHONE_LENGTH) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=phone`);
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      phone,
      name,
      address,
      monthly_medicine: monthly,
      monthly_invoice_no: monthly && invoiceNo ? invoiceNo : null,
      remark: remark || null,
      created_by_branch: profile.branch_id,
    })
    .select("id")
    .single();

  if (error || !created) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);
  }

  if (file && file.size > 0) {
    const path = await uploadPrescriptionFile(created.id, file);
    if (path) {
      await supabase.from("customers").update({ prescription_path: path }).eq("id", created.id);
    }
  }
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=created`);
}

// Update an existing customer (any branch may fix these).
export async function updateCustomer(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const name = String(formData.get("name") ?? "").trim().toUpperCase();
  const address = String(formData.get("address") ?? "").trim().toUpperCase();
  const monthly = formData.get("monthly_medicine") === "on";
  const invoiceNo = String(formData.get("monthly_invoice_no") ?? "").trim();
  const remark = String(formData.get("remark") ?? "").trim();
  if (!id || !name || !address) redirect(`/?phone=${encodeURIComponent(phone)}&error=missing`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      name,
      address,
      monthly_medicine: monthly,
      monthly_invoice_no: monthly && invoiceNo ? invoiceNo : null,
      remark: remark || null,
    })
    .eq("id", id);

  if (error) redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=updated`);
}

// Upload a prescription for an existing customer.
export async function uploadPrescription(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const file = formData.get("prescription") as File | null;
  if (!id || !file || file.size === 0) {
    redirect(`/?phone=${encodeURIComponent(phone)}&error=file`);
  }
  const path = await uploadPrescriptionFile(id, file);
  if (!path) redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);

  const supabase = await createClient();
  await supabase.from("customers").update({ prescription_path: path }).eq("id", id);
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=prescription`);
}

// Delete a customer's prescription: remove the file from storage and clear it.
export async function deletePrescription(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const path = String(formData.get("path") ?? "");
  if (!id) redirect(`/?phone=${encodeURIComponent(phone)}&error=save`);

  if (path) {
    const admin = createAdminClient();
    await admin.storage.from("prescriptions").remove([path]);
  }
  const supabase = await createClient();
  await supabase.from("customers").update({ prescription_path: null }).eq("id", id);
  redirect(`/?phone=${encodeURIComponent(phone)}&ok=prescription_deleted`);
}

// Record a purchase; the DB trigger awards loyalty points automatically.
// A delivery order starts the delivery timer (created_at) for the rider flow.
export async function recordPurchase(formData: FormData) {
  const profile = await requireProfile();
  const customerId = String(formData.get("customer_id") ?? "");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const amount = Number(formData.get("amount"));
  const isDelivery = formData.get("is_delivery") === "on";
  const billNo = String(formData.get("bill_no") ?? "").trim();

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
    is_delivery: isDelivery,
    bill_no: billNo || null,
  });

  if (error) {
    const dup = (error.message || "").includes("DUPLICATE_PURCHASE") || error.code === "23505";
    redirect(`/?phone=${encodeURIComponent(phone)}&error=${dup ? "dup" : "save"}`);
  }
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
