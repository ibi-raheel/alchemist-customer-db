import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  role: "branch" | "admin" | "rider";
  branch_id: string | null;
  branch_name: string | null;
};

// Cached per request: the layout (top bar) and the page both need the profile,
// but React's cache() means the auth + profile lookup runs only ONCE per
// request instead of once per component — halving the round-trips to Supabase.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, role, branch_id, branches(name)")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  return {
    id: data.id,
    role: data.role,
    branch_id: data.branch_id,
    branch_name: (data.branches as unknown as { name: string } | null)?.name ?? null,
  };
});

export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  return profile;
}
