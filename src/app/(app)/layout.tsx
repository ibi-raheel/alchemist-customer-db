import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { signOut } from "./actions";

// Authenticated shell: top bar with branch name + nav. Guards the session.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    <>
      <header className="topbar">
        <div>
          <div className="brand">Alchemist Pharmacy</div>
          <div className="branch">
            {profile.branch_name ?? (profile.role === "admin" ? "Head Office" : "—")}
          </div>
        </div>
        <nav className="nav">
          <Link href="/">Capture</Link>
          <Link href="/reports">Reports</Link>
          {profile.role === "admin" ? <Link href="/admin">Admin</Link> : null}
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
