import { login } from "./actions";
import { PasswordField } from "./PasswordField";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="container">
      <div className="card" style={{ marginTop: 48 }}>
        <h2 style={{ textAlign: "center" }}>Alchemist Pharmacy</h2>
        <p className="center meta">Branch sign in</p>

        {error === "noprofile" ? (
          <div className="alert err">
            This account has no branch assigned. Ask an admin to set it up.
          </div>
        ) : error ? (
          <div className="alert err">Invalid email or password.</div>
        ) : null}

        <form action={login}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />

          <label htmlFor="password">Password</label>
          <PasswordField />

          <button className="btn" type="submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
