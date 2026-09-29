"use client";

import { FormEvent, useState } from "react";
import { changeOwnPassword } from "@/lib/sheets-client";

type Props = {
  token: string;
  onClose: () => void;
};

export function ChangePasswordPanel({ token, onClose }: Props) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await changeOwnPassword(token, currentPassword, newPassword);
      setSuccess("Password changed successfully.");
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Change password</h2>
        </div>
        <button className="panel-close" type="button" onClick={onClose}>Close</button>
      </div>

      <form className="login-form" onSubmit={submit}>
        <label>
          <span>Current password</span>
          <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <label>
          <span>New password</span>
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={6} />
        </label>
        <label>
          <span>Confirm new password</span>
          <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={6} />
        </label>
        {error && <p className="auth-error">{error}</p>}
        {success && <p className="auth-success">{success}</p>}
        <button className="login-button" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </section>
  );
}
