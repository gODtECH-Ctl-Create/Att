"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchStaffDirectory,
  updateStaffApproval,
  updateStaffStatus,
  type StaffDirectoryEntry,
} from "@/lib/sheets-client";

type Props = {
  token: string;
  username: string;
  onClose: () => void;
};

export function AdminStaffPanel({ token, username, onClose }: Props) {
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [busyUser, setBusyUser] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setStaff(await fetchStaffDirectory(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load staff accounts.");
    }
  }, [token]);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [load]);

  const pending = useMemo(
    () => staff.filter((entry) => entry.status.toLowerCase() === "pending"),
    [staff],
  );

  const activeOrInactive = useMemo(
    () => staff.filter((entry) => entry.status.toLowerCase() !== "pending" && entry.status.toLowerCase() !== "rejected"),
    [staff],
  );

  async function approvalAction(
    entry: StaffDirectoryEntry,
    action: "approveStaff" | "rejectStaff",
  ) {
    setBusyUser(entry.username);
    setError("");

    try {
      await updateStaffApproval(token, action, entry.username);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the registration.");
    } finally {
      setBusyUser("");
    }
  }

  async function toggleStatus(entry: StaffDirectoryEntry) {
    const next = entry.status.toLowerCase() === "active" ? "Inactive" : "Active";
    setBusyUser(entry.username);
    setError("");

    try {
      await updateStaffStatus(token, entry.username, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update staff status.");
    } finally {
      setBusyUser("");
    }
  }

  return (
    <section className="admin-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Staff accounts</h2>
        </div>
        <button className="panel-close" type="button" onClick={onClose}>Close</button>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <div className="admin-section">
        <div className="section-label">
          <strong>Pending approval</strong>
          <span>{pending.length}</span>
        </div>

        {pending.length === 0 ? (
          <p className="auth-note">No staff registration requests are waiting.</p>
        ) : (
          <div className="admin-list">
            {pending.map((entry) => (
              <article className="admin-row" key={entry.username}>
                <div>
                  <strong>{entry.name}</strong>
                  <span>@{entry.username}</span>
                </div>
                <div className="admin-actions">
                  <button
                    className="approve-button"
                    disabled={busyUser === entry.username}
                    onClick={() => void approvalAction(entry, "approveStaff")}
                  >
                    Approve
                  </button>
                  <button
                    className="danger-button"
                    disabled={busyUser === entry.username}
                    onClick={() => void approvalAction(entry, "rejectStaff")}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="admin-section">
        <div className="section-label">
          <strong>Staff directory</strong>
          <span>{activeOrInactive.length}</span>
        </div>

        <div className="admin-list">
          {activeOrInactive.map((entry) => {
            const isSelf = entry.username === username;
            const isActive = entry.status.toLowerCase() === "active";

            return (
              <article className="admin-row" key={entry.username}>
                <div>
                  <strong>{entry.name}</strong>
                  <span>@{entry.username} · {entry.role}</span>
                  <small className={isActive ? "staff-active" : "staff-inactive"}>
                    {entry.status}
                  </small>
                </div>
                <div className="admin-actions">
                  <button
                    className="secondary-button"
                    disabled={isSelf || busyUser === entry.username}
                    onClick={() => void toggleStatus(entry)}
                  >
                    {isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
