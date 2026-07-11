"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

export async function createBranch(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  if (!name) redirect("/admin?error=missing");

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .insert({ name, location: location || null });

  if (error) redirect("/admin?error=save");
  redirect("/admin?ok=branch");
}

// Provision a login for a branch: create the auth user (service role) then
// map it to the branch via a profiles row.
export async function provisionBranchLogin(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const branchId = String(formData.get("branch_id") ?? "");

  if (!email || password.length < 8 || !branchId) {
    redirect("/admin?error=login");
  }

  const admin = createAdminClient();
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userErr || !created.user) {
    redirect(`/admin?error=login&msg=${encodeURIComponent(userErr?.message ?? "failed")}`);
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    role: "branch",
    branch_id: branchId,
  });

  if (profErr) {
    // roll back the orphaned auth user so it can be retried cleanly
    await admin.auth.admin.deleteUser(created.user.id);
    redirect(`/admin?error=login&msg=${encodeURIComponent(profErr.message)}`);
  }

  redirect("/admin?ok=login");
}
