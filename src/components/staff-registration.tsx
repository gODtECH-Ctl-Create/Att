"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { registerStaff } from "@/lib/sheets-client";
import { savePendingRegistration } from "@/lib/auth";
import type { PendingRegistration } from "@/lib/auth";

type Props = {
  online: boolean;
  onPending: (registration: PendingRegistration) => void;
  onBackToLogin: () => void;
};

export function StaffRegistration({ online, onPending, onBackToLogin }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const name = String(form.get("name") || "").trim();
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await registerStaff(username, name, password);
      const pending = {
        username: result.username,
        name: result.name,
        registrationToken: result.registrationToken,
      };
      savePendingRegistration(pending);
      onPending(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Staff access</p>
      <h1>Create account</h1>
      <p className="auth-copy">
        Create your staff account. An administrator must approve it before you can use ATT.
      </p>

      <form className="login-form" onSubmit={submit}>
        <label>
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={40}
            placeholder="e.g. frontdesk"
          />
        </label>

        <label>
          <span>Full name</span>
          <input
            name="name"
            autoComplete="name"
            required
            placeholder="e.g. Mary James"
          />
        </label>

        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            placeholder="At least 6 characters"
          />
        </label>

        <label>
          <span>Confirm password</span>
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            placeholder="Re-enter password"
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button className="login-button" disabled={busy || !online}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      {!online && <p className="auth-note">You need an internet connection to submit a registration.</p>}

      <button className="auth-link" type="button" onClick={onBackToLogin}>
        Back to sign in
      </button>
    </section>
  );
}
