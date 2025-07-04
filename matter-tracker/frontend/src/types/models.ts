// src/types/models.ts

export type TimeIncrementType = 'PERCENT' | 'HOURS_MINUTES';
export type DateIncrementType = 'DAY' | 'WEEK';
export type Urgency = 'HOT' | 'MEDIUM' | 'MILD';
export type ITActivityType = 'CALENDAR' | 'EMAIL' | 'DOCUMENT';

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

// New IT Activity interfaces
export interface ITActivity {
  id: string;
  teamMemberId: string;
  teamMember: TeamMember;
  activityType: ITActivityType;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  metadata?: any; // JSON data specific to activity type
  matterId?: string;
  matter?: Matter;
  taskId?: string;
  task?: Task;
  durationMinutes?: number;
  isAssociated: boolean;
  associatedEntry?: TimesheetEntry;
  createdAt: string;
  updatedAt: string;
}

// Metadata interfaces for different activity types
export interface CalendarActivityMetadata {
  location?: string;
  attendees?: string[];
  meetingType?: 'meeting' | 'call' | 'deadline' | 'court_date';
  isAllDay?: boolean;
  recurrencePattern?: string;
}

export interface EmailActivityMetadata {
  recipients?: string[];
  ccRecipients?: string[];
  hasAttachments?: boolean;
  priority?: 'high' | 'normal' | 'low';
  messageId?: string;
  conversationId?: string;
}

export interface DocumentActivityMetadata {
  fileName: string;
  fileSize?: number;
  fileType?: string;
  filePath?: string;
  lastModifiedBy?: string;
  shareStatus?: 'private' | 'shared' | 'public';
  parentFolder?: string;
}

// Request/Response interfaces for API
export interface ITActivityFilters {
  teamMemberId: string;
  startDate: string;
  endDate: string;
  activityType?: ITActivityType;
  isAssociated?: boolean;
}

export interface AssociateActivityRequest {
  activityId: string;
  matterId: string;
  taskId: string;
  durationMinutes: number;
  urgency?: Urgency;
}

export interface CreateTimesheetEntryFromActivityRequest {
  activityId: string;
  matterId: string;
  taskDescription: string;
  durationMinutes: number;
  urgency: Urgency;
  timesheetDate: string; // The date to add this entry to
}