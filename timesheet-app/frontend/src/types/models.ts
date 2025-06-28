// src/types/models.ts

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  workingHours: number;
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
  urgency: 'HOT' | 'MEDIUM' | 'MILD';
  projectedHours: number;
  actualHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface Timesheet {
  id: string;
  teamMemberId: string;
  teamMember: TeamMember;
  weekStartDate: string;
  entries: TimesheetEntry[];
  createdAt: string;
  updatedAt: string;
}

