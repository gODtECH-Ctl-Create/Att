"use client";

import { useEffect, useState } from "react";
import { checkRegistrationApproval, type ApprovalResult } from "@/lib/sheets-client";
import { clearPendingRegistration } from "@/lib/auth";
import type { PendingRegistration } from "@/lib/auth";
import type { StaffSession } from "@/lib/types";

type Props = {
  pending: PendingRegistration;
  online: boolean;
  onApproved: (session: StaffSession) => void;
  onStartOver: () => void;
};

export function PendingApproval({ pending, online, onApproved, onStartOver }: Props) {
  const [status, setStatus] = useState<ApprovalResult["status"]>("pending");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!navigator.onLine) return;

      try {
        const result = await checkRegistrationApproval(pending.registrationToken);
        if (cancelled) return;

        setStatus(result.status);
        setMessage(result.message || "");

        if (result.status === "approved" && result.session) {
          clearPendingRegistration();
          onApproved(result.session);
        }

        if (result.status === "rejected" || result.status === "expired" || result.status === "invalid") {
          clearPendingRegistration();
        }
      } catch {
        // Keep the pending state while the device is temporarily offline.
      }
    }

    void check();
    const timer = window.setInterval(check, 3000);

    const handleOnline = () => void check();
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", handleOnline);
    };
  }, [onApproved, pending.registrationToken]);

  return (
    <section className="auth-card pending-card">
      <div className="pending-icon" aria-hidden="true">
        {status === "approved" ? "✓" : status === "rejected" ? "!" : "…"}
      </div>

      <p className="eyebrow">Staff access</p>

      {status === "pending" && (
        <>
          <h1>Awaiting admin approval</h1>
          <p className="auth-copy">
            Your account for <strong>{pending.name}</strong> is waiting for an administrator to approve it.
          </p>
          <div className="pending-status">
            <span className="status-dot" aria-hidden="true" />
            {online ? "Checking for approval automatically" : "Waiting for your connection to return"}
          </div>
          <p className="auth-note">
            You can close the app. Your registration stays pending and will be checked again when you reopen it.
          </p>
        </>
      )}

      {status === "rejected" && (
        <>
          <h1>Registration not approved</h1>
          <p className="auth-copy">{message || "An administrator did not approve this registration."}</p>
          <button className="login-button" type="button" onClick={onStartOver}>
            Create another account
          </button>
        </>
      )}

      {(status === "expired" || status === "invalid") && (
        <>
          <h1>Registration expired</h1>
          <p className="auth-copy">
            This registration request is no longer valid. Create a new account request to continue.
          </p>
          <button className="login-button" type="button" onClick={onStartOver}>
            Create account
          </button>
        </>
      )}
    </section>
  );
}
