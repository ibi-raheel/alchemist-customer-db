import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { signOut } from "./actions";

// Authenticated shell: top bar with branch name + role-based nav.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isRider = profile.role === "rider";
  const isAdmin = profile.role === "admin";
  const isBranch = profile.role === "branch";

  return (
    <>
      <header className="topbar">
        <div>
          <div className="brand">Alchemist Pharmacy</div>
          <div className="branch">
            {profile.branch_name ?? (isAdmin ? "Head Office" : "—")}
            {isRider ? " · Rider" : ""}
          </div>
        </div>
        <nav className="nav">
          {isRider ? (
            <Link href="/rider">Deliveries</Link>
          ) : (
            <>
              <Link href="/">Capture</Link>
              <Link href="/reports">Reports</Link>
              {isBranch ? <Link href="/rider">Deliveries</Link> : null}
              {isAdmin ? <Link href="/admin">Admin</Link> : null}
            </>
          )}
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
