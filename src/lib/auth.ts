import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  role: "branch" | "admin";
  branch_id: string | null;
  branch_name: string | null;
};

// Returns the signed-in user's profile (with branch name), or redirects to
// /login if there is no session. Used by every authenticated page/action.
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("id, role, branch_id, branches(name)")
    .eq("id", user.id)
    .single();

  if (!data) {
    // Authenticated but no profile row — misconfigured account.
    redirect("/login?error=noprofile");
  }

  return {
    id: data.id,
    role: data.role,
    branch_id: data.branch_id,
    branch_name: (data.branches as unknown as { name: string } | null)?.name ?? null,
  };
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  return profile;
}
