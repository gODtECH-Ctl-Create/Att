# Att — School Attendance PWA

Att is an installable, offline-first school attendance app for recording student arrival and departure times. Google Sheets is used as the cloud backing store while IndexedDB keeps the app usable during internet outages.

## Current MVP

- Installable PWA shell.
- Student list with class filtering and search.
- **Arrived** and **Mark left** actions with automatic timestamps.
- One attendance record per student per school day.
- IndexedDB local storage using Dexie.
- Automatic retry when the device comes back online.
- Google Sheets read/write adapter on the server.
- Demo students when Google Sheets has not been configured yet.

## Data flow

```text
Teacher phone/tablet
       |
       v
Next.js PWA
       |
       +--> IndexedDB (offline students + pending attendance)
       |
       v
Next.js Route Handlers
       |
       v
Google Sheets API
       |
       v
School Attendance Spreadsheet
```

## Google Sheet structure

Create one spreadsheet with these tabs and headings.

### Students

| Student ID | Name | Class | Status |
| --- | --- | --- | --- |
| ST001 | Mary James | Primary 4 | Active |

### Attendance

| Date | Student ID | Name | Class | Arrival | Departure | Last Updated |
| --- | --- | --- | --- | --- | --- | --- |

Do not add daily attendance columns to the Students sheet. Each student/day combination gets one row in the Attendance tab.

## Google Cloud setup

1. Create or choose a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account and service-account key.
4. Share the attendance spreadsheet with the service account email as **Editor**.
5. Copy `.env.example` to `.env.local` and add the spreadsheet ID, service-account email and private key.

```bash
cp .env.example .env.local
```

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Important MVP notes

Authentication and admin/student-management screens are intentionally not included yet. The next phase should add staff authentication, student management, attendance history/reports and stricter sync conflict rules before production use.
