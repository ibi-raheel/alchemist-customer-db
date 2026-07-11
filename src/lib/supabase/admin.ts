import { createClient } from "@supabase/supabase-js";

// Service-role client. SERVER ONLY — never import into a Client Component.
// Bypasses RLS; used solely for admin branch-login provisioning.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
