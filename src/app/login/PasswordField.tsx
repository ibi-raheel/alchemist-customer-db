"use client";

import { useState } from "react";

// Password input with a show/hide toggle. The only client-side JS in the app —
// kept tiny and scoped to the login page.
export function PasswordField() {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        id="password"
        name="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        required
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
