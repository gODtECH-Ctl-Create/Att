# Att

Offline-first school attendance PWA hosted on **GitHub Pages**, with **Google Sheets as the permanent datastore**.

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
            ▼
       Google Sheets
       ├── Students
       └── Attendance
```

There is **no separate database server**. Google Sheets is the source of truth. IndexedDB only keeps a local copy of students and unsynced attendance while a device is offline.

## Google Sheet structure

Create a Google Sheet, then open **Extensions → Apps Script** and paste the contents of:

```text
google-apps-script/Code.gs
```

Run this function once from Apps Script:

```text
setupAttendanceWorkbook
```

It creates the required tabs and headers.

### Students tab

| Student ID | Name | Class | Status |
|---|---|---|---|
| ST001 | Mary James | Primary 4 | Active |
| ST002 | John Ade | Primary 4 | Active |

### Attendance tab

| Date | Student ID | Student Name | Class | Arrival | Departure | Updated At |
|---|---|---|---|---|---|---|

One student gets one attendance row per day. Pressing **Arrived** writes the arrival time. Pressing **Mark left** later updates the same row with the departure time.

## Deploy the Apps Script bridge

From Apps Script:

1. Select **Deploy → New deployment**.
2. Choose **Web app**.
3. Execute the app as yourself.
4. Choose the access option appropriate for the school setup.
5. Deploy and copy the `/exec` URL.

The URL will look similar to:

```text
https://script.google.com/macros/s/.../exec
```

## Connect GitHub Pages to the Sheet

In this GitHub repository:

1. Go to **Settings → Secrets and variables → Actions → Variables**.
2. Create a repository variable named:

```text
NEXT_PUBLIC_APPS_SCRIPT_URL
```

3. Set its value to the Apps Script `/exec` URL.
4. Go to **Settings → Pages** and set the source to **GitHub Actions**.
5. Re-run the Pages workflow or push a commit to `main`.

The workflow in `.github/workflows/deploy-pages.yml` builds the static Next.js export and publishes the `out/` directory to GitHub Pages.

Expected project URL:

```text
https://godtech-ctl-create.github.io/Att/
```

## Offline behaviour

When the device has internet access:

```text
PWA → Apps Script → Google Sheets
```

When internet access is unavailable:

```text
PWA → IndexedDB
```

The teacher can continue marking students as arrived or left. When connectivity returns, pending records are synchronized to Google Sheets automatically.

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

## Security note

GitHub Pages is a public static host. Do not place Google service-account private keys, passwords, or other secrets in this repository or in `NEXT_PUBLIC_*` environment variables.

The current Apps Script bridge is suitable for initial development and controlled testing. Before storing real student attendance in production, add staff authentication/access control to the Apps Script endpoint or use Google-account-based authorization.
