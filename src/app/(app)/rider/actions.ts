"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Rider taps "Delivered" — the DB function stamps delivered_at (own branch only).
export async function markDelivered(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("purchase_id") ?? "");
  if (!id) redirect("/rider?error=1");

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_delivered", { p_purchase: id });
  if (error) redirect("/rider?error=1");

  revalidatePath("/rider");
  redirect("/rider?ok=1");
}
