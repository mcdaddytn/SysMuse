# Matter Tracker - Application Updates

## Overview
The timesheet application has been renamed to "Matter Tracker" and enhanced with flexible time tracking capabilities, supporting both percentage-based and time-based entry methods, as well as both daily and weekly timesheet views.

## Key Changes

### 1. Application Rebranding
- **Name Change**: "Time Tracker" → "Matter Tracker"
- Updated in all UI components, titles, and documentation
- Package.json productName updated
- Main layout header updated

### 2. Enhanced Time Tracking System

#### Time Increment Types
- **PERCENT**: Traditional percentage-based tracking (0-100%)
- **HOURS_MINUTES**: Time-based tracking with HH:MM format

#### Time Increment Settings
- **Percent Mode**: Only allows increment of 1
- **Hours/Minutes Mode**: Supports increments of 1, 2, 3, 5, 6, 10, 12, 15, 20, or 30 minutes
- Invalid increments are automatically adjusted to the nearest valid value

#### Team Member Configuration
Each team member can have individual settings:
- `timeIncrementType`: PERCENT or HOURS_MINUTES
- `timeIncrement`: The step size for time adjustments
- `workingHours`: Total hours per week (for validation and calculations)

### 3. Dual Date Tracking System

#### Date Increment Types
- **WEEK**: Traditional weekly timesheets (Sunday to Saturday)
- **DAY**: Daily timesheets for single-day tracking

#### Timesheet Storage
- Both weekly and daily timesheets can coexist
- Each timesheet stores its own configuration:
  - `dateIncrementType`: DAY or WEEK
  - `timeIncrementType`: PERCENT or HOURS_MINUTES
  - `timeIncrement`: The increment value used
  - `startDate`: Either a Sunday (for weekly) or any date (for daily)

### 4. Enhanced User Interface

#### Weekly Timesheet Page (`/`)
- Traditional weekly view with Sunday-Saturday range
- Date picker restricted to Sundays only
- "Copy from Last Week" functionality
- "Switch to Daily" button to toggle views
- Time entry with spin controls for easy adjustment

#### Daily Timesheet Page (`/daily`)
- Single-day view with full date display
- Any date can be selected (not restricted to Sundays)
- "Copy from Previous Day" functionality
- "Switch to Weekly" button to toggle views
- Same time entry interface as weekly view

#### Smart Time Display
- **Percent Mode**: Shows "85%" with tooltip showing equivalent hours
- **Time Mode**: Shows "02:30" with tooltip showing percentage of total time
- Spin controls increment/decrement by the configured time increment
- Real-time validation and formatting

### 5. Task Management Enhancement

#### Add New Task Feature
- "Add New Task" option appears in task dropdown when a matter is selected
- Dialog allows creation of new tasks with matter validation
- Automatic uniqueness checking within each matter
- New tasks immediately available for selection

#### Task Suggestions
- Dynamic loading of existing tasks for selected matters
- Autocomplete functionality with ability to add new values
- Integration with new task creation dialog

### 6. Database Schema Updates

#### New Fields Added
```sql
-- TeamMember table
timeIncrementType TimeIncrementType @default(PERCENT)
timeIncrement     Int               @default(1)

-- Timesheet table  
startDate         DateTime          -- Renamed from weekStartDate
dateIncrementType DateIncrementType @default(WEEK)
timeIncrementType TimeIncrementType @default(PERCENT)
timeIncrement     Int               @default(1)

-- TimesheetEntry table
projectedTime     Int               -- Renamed from projectedHours
actualTime        Int               -- Renamed from actualHours
```

#### New Enums
```sql
enum TimeIncrementType {
  PERCENT
  HOURS_MINUTES
}

enum DateIncrementType {
  DAY
  WEEK
}
```

### 7. API Enhancements

#### Updated Endpoints
- `GET /timesheets/{teamMemberId}/{startDate}/{dateIncrementType}`
- `POST /timesheets/{teamMemberId}/{startDate}/{dateIncrementType}`
- `POST /timesheets/{teamMemberId}/{startDate}/{dateIncrementType}/copy-from-previous`
- `POST /timesheets/tasks` (new endpoint for task creation)

#### Enhanced Validation
- Time increment validation with auto-correction
- Date validation based on increment type
- Duplicate entry prevention
- Total time validation (flexible for daily vs weekly)

### 8. Utility Functions

#### Time Formatting (`src/utils/timeUtils.ts`)
- `formatTime()`: Format values as percentage or HH:MM
- `parseTimeInput()`: Parse user input to internal format
- `formatTimeWithTooltip()`: Generate display text and tooltips
- `validateTimeIncrement()`: Validate and correct increment values
- `getMaxTimeValue()`: Calculate maximum allowed time
- `isValidTotalTime()`: Validate total time against limits

## Usage Instructions

### Setting up Team Members
1. Configure each team member's time preferences in the database
2. Set `timeIncrementType` to either PERCENT or HOURS_MINUTES
3. Set `timeIncrement` to desired step size
4. System will auto-correct invalid increments

### Using Weekly Timesheets
1. Navigate to the main page (`/`)
2. Select team member from dropdown
3. Navigate weeks using arrow buttons or date picker
4. Enter time using either percentage or HH:MM format
5. Use spin controls for precise adjustments
6. Save when totals are appropriate

### Using Daily Timesheets
1. Navigate to daily page (`/daily`) or click "Switch to Daily"
2. Select team member from dropdown
3. Navigate days using arrow buttons or date picker
4. Enter time data (validation is more flexible for partial days)
5. Use same time entry interface as weekly view

### Creating New Tasks
1. Select a matter in any timesheet entry
2. Click in the task field
3. Select "Add New Task" from the dropdown
4. Enter task description and click "Add Task"
5. Task becomes immediately available for selection

## Database Migration

### Required Steps
1. Update schema.prisma with new fields and enums
2. Run `npx prisma migrate dev` to create migration
3. Update seed data with new team member configurations
4. Run `npm run prisma:seed` to populate test data

### Data Migration Considerations
- Existing `weekStartDate` data maps to `startDate`
- Existing `projectedHours`/`actualHours` map to `projectedTime`/`actualTime`
- Default values handle migration of existing records
- Team members default to PERCENT mode with 1% increments

## Technical Implementation

### Frontend Architecture
- Shared components between weekly and daily views
- Reactive time formatting based on team member settings
- Utility functions for consistent time handling
- Type-safe interfaces for all data structures

### Backend Architecture
- Flexible API endpoints supporting both date increment types
- Validation logic for time increments and totals
- Task creation with matter-scoped uniqueness
- Comprehensive error handling and logging

### State Management
- Local component state for form data
- Reactive computed properties for formatting
- Efficient API calls with proper error handling
- Consistent user experience across views

## Future Enhancements

### Potential Improvements
1. Bulk operations for multiple timesheet entries
2. Advanced reporting with time aggregation
3. Team member preference management UI
4. Import/export functionality for timesheet data
5. Integration with external time tracking tools
6. Mobile-responsive design improvements
7. Keyboard shortcuts for power users
8. Audit trail for timesheet changes

### Configuration Options
1. Configurable working hours per team member
2. Custom time increment options
3. Flexible validation rules
4. Customizable date ranges and formats
5. Integration with calendar systems

This enhanced Matter Tracker provides a flexible, user-friendly interface for time tracking that adapts to different working styles and preferences while maintaining data integrity and providing powerful reporting capabilities.