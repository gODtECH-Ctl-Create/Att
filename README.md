# Att

Offline-first school attendance PWA hosted on **GitHub Pages**, with **Google Sheets as the permanent datastore** and Apps Script enforcing staff access.

## Architecture

```text
GitHub Pages
    │
    ▼
Attendance PWA
    │
    ├── IndexedDB
    │   Temporary offline cache / sync queue
    │
    └── Google Apps Script Web App
            │
            ├── Staff authentication + sessions
            │
            ▼
       Google Sheets
       ├── Students
       ├── Attendance
       └── Staff
```

There is **no separate database server**. Google Sheets is the source of truth. IndexedDB only keeps a local copy of students and unsynced attendance while a previously authenticated device is offline.

## Google Sheet structure

Open **Extensions → Apps Script** in the attendance spreadsheet and paste the latest contents of:

```text
google-apps-script/Code.gs
```

Run this function once after updating the script:

```text
setupAttendanceWorkbook
```

It creates or updates the required tabs and headers.

### Students tab

| Student ID | Name | Class | Status |
|---|---|---|---|
| ST001 | Mary James | Primary 4 | Active |

### Attendance tab

| Date | Student ID | Student Name | Class | Arrival | Departure | Updated At | Updated By |
|---|---|---|---|---|---|---|---|

One student gets one attendance row per day. Pressing **Arrived** writes the arrival time. Pressing **Mark left** later updates the same row with the departure time. `Updated By` records the signed-in staff member who last updated the row.

### Staff tab

| Username | Name | PIN Hash | Salt | Role | Status |
|---|---|---|---|---|---|

Plain PINs are never stored in the sheet. Apps Script stores a salted SHA-256 hash.

## Staff account flow

Staff accounts are created from the ATT application.

```text
Staff
  │
  ├── Create account
  │      ├── Username
  │      ├── Full name
  │      ├── Password
  │      └── Confirm password
  │
  ▼
Awaiting admin approval
  │
  ▼
Admin opens Staff from the ATT app
  │
  ├── Approve
  └── Reject
  │
  ▼
Staff is admitted to ATT
```

The registration request is stored as `Pending` in the `Staff` sheet. Passwords are stored only as salted SHA-256 hashes.

A pending device keeps a short-lived registration token locally. ATT checks the approval status automatically, so once an administrator approves the request, the staff member is signed in automatically. Closing and reopening the app also resumes the pending registration and checks for approval.

Approved staff can open **Account → Change password** to update their own password. Admins can open **Staff** to approve or reject requests and enable or disable existing staff accounts.

The school still needs at least one active administrator account to approve new staff. Keep that bootstrap admin account active.

`Staff` columns:

| Username | Name | Password Hash | Salt | Role | Status | Must Change Password |
|---|---|---|---|---|---|---|
| frontdesk | Mary James | salted hash | random salt | Staff | Active | FALSE |

`Status` can be `Pending`, `Active`, `Inactive`, or `Rejected`.

## Update the Apps Script deployment

Because Apps Script is deployed separately from GitHub Pages, changes to `google-apps-script/Code.gs` must also be deployed in Google:

1. Paste the latest `Code.gs` into **Extensions → Apps Script**.
2. Save.
3. Run `setupAttendanceWorkbook` once.
4. Select **Deploy → Manage deployments**.
5. Edit the existing Web app deployment.
6. Select **New version**.
7. Deploy.

Keep the same `/exec` URL. The GitHub Pages app is already configured to use it.

## Staff access flow

```text
Staff username + PIN
        │
        ▼
Google Apps Script
        │
        ├── validates salted PIN hash in Staff sheet
        └── issues temporary session token
                │
                ▼
        Students / Attendance access
```

The session token is stored on the device and expires after 12 hours. When offline, a device with a still-valid session can continue using its cached student list and queue attendance locally. Sync resumes when internet access returns.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds the static Next.js export and publishes `out/` to GitHub Pages.

Project URL:

```text
https://godtech-ctl-create.github.io/Att/
```

## Offline behaviour

Online:

```text
PWA → authenticated Apps Script → Google Sheets
```

Offline after a successful staff login:

```text
PWA → IndexedDB
```

When connectivity returns, pending records synchronize automatically. If the staff session has expired, the app asks the staff member to sign in again before synchronization can continue.

## Local development

Copy the environment file:

```bash
cp .env.example .env.local
```

Add the Apps Script URL, then run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Security

- No Google service-account private key is stored in GitHub Pages.
- Staff PINs are not stored in plain text.
- Student and attendance endpoints require a valid staff session.
- Five failed sign-in attempts temporarily lock that username for 10 minutes.
- Staff can be disabled by setting their `Status` to `Inactive` in the Staff sheet.
- The GitHub Pages repository remains public, but access to live student data is enforced by Apps Script.
