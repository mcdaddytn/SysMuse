// src/types/models.ts

export type TimeIncrementType = 'PERCENT' | 'HOURS_MINUTES';
export type DateIncrementType = 'DAY' | 'WEEK';
export type Urgency = 'HOT' | 'MEDIUM' | 'MILD';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  workingHours: number;
  timeIncrementType: TimeIncrementType;
  timeIncrement: number;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Matter {
  id: string;
  name: string;
  description?: string;
  clientId: string;
  client: Client;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  description: string;
  matterId: string;
  matter?: Matter;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetEntry {
  id: string;
  timesheetId: string;
  matterId: string;
  matter: Matter;
  taskId?: string;
  task?: Task;
  taskDescription: string;
  urgency: Urgency;
  projectedTime: number;
  actualTime: number;
  createdAt: string;
  updatedAt: string;
}

export interface Timesheet {
  id: string;
  teamMemberId: string;
  teamMember: TeamMember;
  startDate: string;
  dateIncrementType: DateIncrementType;
  timeIncrementType: TimeIncrementType;
  timeIncrement: number;
  entries: TimesheetEntry[];
  createdAt: string;
  updatedAt: string;
}
