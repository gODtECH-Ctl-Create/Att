"use client";

import Dexie, { type EntityTable } from "dexie";
import type { AttendanceRecord, Student } from "./types";

class AttendanceDatabase extends Dexie {
  students!: EntityTable<Student, "id">;
  attendance!: EntityTable<AttendanceRecord, "id">;

  constructor() {
    super("att-school-attendance");

    this.version(1).stores({
      students: "id, name, className, status",
      attendance: "id, studentId, date, [date+studentId]",
    });
  }
}

export const db = new AttendanceDatabase();
