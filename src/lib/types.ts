export type StudentStatus = "Active" | "Inactive";

export type Student = {
  id: string;
  name: string;
  className: string;
  status: StudentStatus;
};

export type AttendanceRecord = {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  date: string;
  arrivalAt?: string;
  departureAt?: string;
  updatedAt: string;
  synced: boolean;
};

export type SyncResponse = {
  syncedIds: string[];
};
