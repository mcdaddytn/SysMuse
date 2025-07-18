// src/routes/timesheet.routes.ts

import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient, Urgency, TimeIncrementType, DateIncrementType } from '@prisma/client';
import { requireAuth } from './auth.routes';

const router = express.Router();
const prisma = new PrismaClient();

interface TimesheetEntryInput {
  matterId: string;
  taskDescription: string;
  urgency: Urgency;
  projectedTime: number;
  actualTime: number;
}

interface TimesheetInput {
  entries: TimesheetEntryInput[];
  dateIncrementType: DateIncrementType;
  timeIncrementType: TimeIncrementType;
  timeIncrement: number;
}

// Get timesheet for a specific team member, date, and increment type
router.get('/:teamMemberId/:startDate/:dateIncrementType', requireAuth, async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}>, res: Response): Promise<void> => {
  const { teamMemberId, startDate, dateIncrementType } = req.params;
  console.log(`API: GET /timesheets/${teamMemberId}/${startDate}/${dateIncrementType} - Fetching timesheet`);
  try {
    
    // Validate dateIncrementType
    if (!['DAY', 'WEEK'].includes(dateIncrementType)) {
      res.status(400).json({ error: 'Invalid date increment type. Must be DAY or WEEK.' });
      return;
    }

    // Parse date ensuring it's treated as local date
    const parsedStartDate = new Date(startDate + 'T00:00:00');
    
    // For weekly mode, ensure the date is a Sunday
    if (dateIncrementType === 'WEEK') {
      const day = parsedStartDate.getDay();
      if (day !== 0) {
        console.log(`Date ${startDate} is not a Sunday (day: ${day})`);
        res.status(400).json({ error: 'Week start date must be a Sunday' });
        return;
      }
    }

    // Get team member to use their settings as defaults
    const teamMember = await prisma.teamMember.findUnique({
      where: { id: teamMemberId },
    });

    if (!teamMember) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    let timesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId,
        startDate: parsedStartDate,
        dateIncrementType: dateIncrementType as DateIncrementType,
      },
      include: {
        entries: {
          include: {
            matter: {
              include: {
                client: true,
              },
            },
            task: true,
            itActivityAssociations: {
              include: {
                itActivity: {
                  include: {
                    teamMember: true,
                  },
                },
              },
            },
          },
        },
        teamMember: true,
      },
    });

    if (!timesheet) {
      // Get global settings for fallback values
      const globalTimeIncrementType = await prisma.settings.findUnique({
        where: { key: 'timeIncrementType' }
      });
      const globalTimeIncrement = await prisma.settings.findUnique({
        where: { key: 'timeIncrement' }
      });

      // Use team member settings or fall back to global settings
      const effectiveTimeIncrementType = teamMember.timeIncrementType ?? 
        (globalTimeIncrementType?.value as string) ?? 'HOURS_MINUTES';
      const effectiveTimeIncrement = teamMember.timeIncrement ?? 
        (globalTimeIncrement?.value as number) ?? 15;


      // Create empty timesheet if it doesn't exist, using effective defaults
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          startDate: parsedStartDate,
          dateIncrementType: dateIncrementType as DateIncrementType,
          timeIncrementType: effectiveTimeIncrementType as TimeIncrementType,
          timeIncrement: effectiveTimeIncrement,
        },
        include: {
          entries: {
            include: {
              matter: {
                include: {
                  client: true,
                },
              },
              task: true,
              itActivityAssociations: {
                include: {
                  itActivity: {
                    include: {
                      teamMember: true,
                    },
                  },
                },
              },
            },
          },
          teamMember: true,
        },
      });
    }

    // Apply inheritance logic for team members without explicit time settings
    if (timesheet && teamMember && (!teamMember.timeIncrementType || !teamMember.timeIncrement)) {
      const globalTimeIncrementType = await prisma.settings.findUnique({
        where: { key: 'timeIncrementType' }
      });
      const globalTimeIncrement = await prisma.settings.findUnique({
        where: { key: 'timeIncrement' }
      });

      // Override timesheet settings with proper inheritance
      if (!teamMember.timeIncrementType) {
        timesheet.timeIncrementType = ((globalTimeIncrementType?.value as string) || 'HOURS_MINUTES') as TimeIncrementType;
      }
      if (!teamMember.timeIncrement) {
        timesheet.timeIncrement = (globalTimeIncrement?.value as number) || 15;
      }
    }

    console.log(`API: GET /timesheets/${teamMemberId}/${startDate}/${dateIncrementType} - Successfully fetched timesheet (ID: ${timesheet?.id})`);
    res.json(timesheet);
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// Save or update timesheet entries
router.post('/:teamMemberId/:startDate/:dateIncrementType', async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}, any, TimesheetInput>, res: Response): Promise<void> => {
  const { teamMemberId, startDate, dateIncrementType } = req.params;
  const { entries, dateIncrementType: bodyDateIncrementType, timeIncrementType, timeIncrement } = req.body;
  console.log(`API: POST /timesheets/${teamMemberId}/${startDate}/${dateIncrementType} - Saving timesheet with ${entries.length} entries`);
  try {
    
    // Validate dateIncrementType
    if (!['DAY', 'WEEK'].includes(dateIncrementType)) {
      res.status(400).json({ error: 'Invalid date increment type. Must be DAY or WEEK.' });
      return;
    }

    // Parse date ensuring it's treated as local date
    const parsedStartDate = new Date(startDate + 'T00:00:00');

    // For weekly mode, validate that the date is a Sunday
    if (dateIncrementType === 'WEEK') {
      const day = parsedStartDate.getDay();
      if (day !== 0) {
        console.log(`Date ${startDate} is not a Sunday (day: ${day})`);
        res.status(400).json({ error: 'Week start date must be a Sunday' });
        return;
      }
    }

    // Validate time totals for percentage mode
    if (timeIncrementType === 'PERCENT') {
      const projectedSum = entries.reduce((sum, entry) => sum + entry.projectedTime, 0);
      const actualSum = entries.reduce((sum, entry) => sum + entry.actualTime, 0);

      if (projectedSum !== 100 || actualSum !== 100) {
        console.warn(`Warning: Percentages don't sum to 100% - Projected: ${projectedSum}%, Actual: ${actualSum}%`);
      }
    }

    // Check projected hours warning setting
    const projectedHoursWarningSetting = await prisma.settings.findUnique({
      where: { key: 'projectedHoursWarning' }
    });
    const projectedHoursWarning = projectedHoursWarningSetting?.value as string || 'Never';

    let warnings: string[] = [];

    if (projectedHoursWarning !== 'Never') {
      // Get team member's working hours
      const teamMember = await prisma.teamMember.findUnique({
        where: { id: teamMemberId },
        select: { workingHours: true }
      });

      const projectedSum = entries.reduce((sum, entry) => sum + entry.projectedTime, 0);

      if (timeIncrementType === 'PERCENT') {
        // For percentage mode, check if projected is below 100%
        if (projectedSum < 100) {
          // Determine if timesheet period is in the past
          const isInPast = () => {
            const today = new Date();
            if (dateIncrementType === 'WEEK') {
              // Check if week ending date has passed
              const weekEnd = new Date(parsedStartDate);
              weekEnd.setDate(weekEnd.getDate() + 6);
              return today > weekEnd;
            } else {
              // Check if day has passed
              return today > new Date(parsedStartDate.getTime() + 24 * 60 * 60 * 1000);
            }
          };

          const isPast = isInPast();
          const shouldWarn = projectedHoursWarning === 'Always' || 
                           (projectedHoursWarning === 'Past' && isPast);

          console.log('ProjectedHoursWarning debug (PERCENT):', {
            setting: projectedHoursWarning,
            projectedPercent: projectedSum,
            target: '100%',
            isPast,
            shouldWarn,
            startDate: startDate,
            timeIncrementType
          });

          if (shouldWarn) {
            const periodType = dateIncrementType === 'WEEK' ? 'week' : 'day';
            warnings.push(
              `Projected time (${projectedSum}%) is below target (100%) for this ${periodType}.`
            );
          }
        }
      } else if (teamMember?.workingHours) {
        // For hours/minutes mode, check against working hours
        const targetHours = dateIncrementType === 'DAY' 
          ? teamMember.workingHours / 5  // Daily target
          : teamMember.workingHours;     // Weekly target
        
        // Convert to hours if needed
        const projectedHours = timeIncrementType === 'HOURS_MINUTES' 
          ? projectedSum / 60  // Convert minutes to hours
          : projectedSum;      // Already in hours

        // Check if projected hours are below target
        if (projectedHours < targetHours) {
          // Determine if timesheet period is in the past
          const isInPast = () => {
            const today = new Date();
            if (dateIncrementType === 'WEEK') {
              // Check if week ending date has passed
              const weekEnd = new Date(parsedStartDate);
              weekEnd.setDate(weekEnd.getDate() + 6);
              return today > weekEnd;
            } else {
              // Check if day has passed
              return today > new Date(parsedStartDate.getTime() + 24 * 60 * 60 * 1000);
            }
          };

          const isPast = isInPast();
          const shouldWarn = projectedHoursWarning === 'Always' || 
                           (projectedHoursWarning === 'Past' && isPast);

          console.log('ProjectedHoursWarning debug (HOURS):', {
            setting: projectedHoursWarning,
            projectedHours: projectedHours.toFixed(1),
            targetHours,
            isPast,
            shouldWarn,
            startDate: startDate,
            timeIncrementType
          });

          if (shouldWarn) {
            const periodType = dateIncrementType === 'WEEK' ? 'week' : 'day';
            warnings.push(
              `Projected time (${projectedHours.toFixed(1)}h) is below target hours (${targetHours}h) for this ${periodType}.`
            );
          }
        }
      }
    }

    // Validate no duplicate entries
    const uniqueEntries = new Set(
      entries.map(e => `${e.matterId}-${e.taskDescription}`)
    );
    if (uniqueEntries.size !== entries.length) {
      res.status(400).json({ 
        error: 'Duplicate entries found for the same matter and task description' 
      });
      return;
    }

    // Get global settings for fallback if needed
    let effectiveTimeIncrementType = timeIncrementType;
    let effectiveTimeIncrement = timeIncrement;

    if (!timeIncrementType || !timeIncrement) {
      const globalTimeIncrementType = await prisma.settings.findUnique({
        where: { key: 'timeIncrementType' }
      });
      const globalTimeIncrement = await prisma.settings.findUnique({
        where: { key: 'timeIncrement' }
      });

      effectiveTimeIncrementType = timeIncrementType || 
        (globalTimeIncrementType?.value as string) || 'HOURS_MINUTES';
      effectiveTimeIncrement = timeIncrement || 
        (globalTimeIncrement?.value as number) || 15;
    }

    // Create or update timesheet
    let timesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId,
        startDate: parsedStartDate,
        dateIncrementType: dateIncrementType as DateIncrementType,
      },
    });

    if (!timesheet) {
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          startDate: parsedStartDate,
          dateIncrementType: dateIncrementType as DateIncrementType,
          timeIncrementType: effectiveTimeIncrementType as TimeIncrementType,
          timeIncrement: effectiveTimeIncrement,
        },
      });
    } else {
      // Update timesheet settings
      timesheet = await prisma.timesheet.update({
        where: { id: timesheet.id },
        data: {
          timeIncrementType: effectiveTimeIncrementType as TimeIncrementType,
          timeIncrement: effectiveTimeIncrement,
        },
      });
    }

    // Delete existing entries and create new ones
    await prisma.timesheetEntry.deleteMany({
      where: { timesheetId: timesheet.id },
    });

    // Create new entries
    await prisma.timesheetEntry.createMany({
      data: entries.map(entry => ({
        timesheetId: timesheet.id,
        matterId: entry.matterId,
        taskDescription: entry.taskDescription,
        urgency: entry.urgency,
        projectedTime: entry.projectedTime,
        actualTime: entry.actualTime,
      })),
    });

    // Create task associations if they don't exist
    for (const entry of entries) {
      const existingTask = await prisma.task.findFirst({
        where: {
          matterId: entry.matterId,
          description: entry.taskDescription,
        },
      });

      if (!existingTask) {
        await prisma.task.create({
          data: {
            matterId: entry.matterId,
            description: entry.taskDescription,
          },
        });
      }
    }

    // Fetch and return the updated timesheet
    const updatedTimesheet = await prisma.timesheet.findUnique({
      where: { id: timesheet.id },
      include: {
        entries: {
          include: {
            matter: {
              include: {
                client: true,
              },
            },
            task: true,
            itActivityAssociations: {
              include: {
                itActivity: {
                  include: {
                    teamMember: true,
                  },
                },
              },
            },
          },
        },
        teamMember: true,
      },
    });

    console.log(`API: POST /timesheets/${teamMemberId}/${startDate}/${dateIncrementType} - Successfully saved timesheet (ID: ${timesheet.id})`);
    
    // Include warnings in response if any
    const response: any = updatedTimesheet;
    if (warnings.length > 0) {
      response.warnings = warnings;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error saving timesheet:', error);
    res.status(500).json({ error: 'Failed to save timesheet' });
  }
});

// Copy timesheet from previous period
router.post('/:teamMemberId/:startDate/:dateIncrementType/copy-from-previous', async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}>, res: Response): Promise<void> => {
  const { teamMemberId, startDate, dateIncrementType } = req.params;
  console.log(`API: POST /timesheets/${teamMemberId}/${startDate}/${dateIncrementType}/copy-from-previous - Copying from previous period`);
  try {
    
    // Validate dateIncrementType
    if (!['DAY', 'WEEK'].includes(dateIncrementType)) {
      res.status(400).json({ error: 'Invalid date increment type. Must be DAY or WEEK.' });
      return;
    }

    // Parse date ensuring it's treated as local date
    const currentStartDate = new Date(startDate + 'T00:00:00');
    
    // Calculate previous period start date
    const previousStartDate = new Date(currentStartDate);
    if (dateIncrementType === 'WEEK') {
      previousStartDate.setDate(previousStartDate.getDate() - 7);
    } else {
      previousStartDate.setDate(previousStartDate.getDate() - 1);
    }

    // Get previous period's timesheet
    const previousTimesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId,
        startDate: previousStartDate,
        dateIncrementType: dateIncrementType as DateIncrementType,
      },
      include: {
        entries: true,
      },
    });

    if (!previousTimesheet || previousTimesheet.entries.length === 0) {
      res.status(404).json({ error: 'No previous period data found to copy' });
      return;
    }

    // Create or get current period's timesheet
    let currentTimesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId,
        startDate: currentStartDate,
        dateIncrementType: dateIncrementType as DateIncrementType,
      },
    });

    if (!currentTimesheet) {
      currentTimesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          startDate: currentStartDate,
          dateIncrementType: dateIncrementType as DateIncrementType,
          timeIncrementType: previousTimesheet.timeIncrementType,
          timeIncrement: previousTimesheet.timeIncrement,
        },
      });
    }

    // Delete existing entries in current period
    await prisma.timesheetEntry.deleteMany({
      where: { timesheetId: currentTimesheet.id },
    });

    // Copy entries from previous period
    await prisma.timesheetEntry.createMany({
      data: previousTimesheet.entries.map((entry: any) => ({
        timesheetId: currentTimesheet!.id,
        matterId: entry.matterId,
        taskDescription: entry.taskDescription,
        urgency: entry.urgency,
        projectedTime: entry.projectedTime,
        actualTime: 0, // Reset actual time for new period
      })),
    });

    // Fetch and return the updated timesheet
    const updatedTimesheet = await prisma.timesheet.findUnique({
      where: { id: currentTimesheet.id },
      include: {
        entries: {
          include: {
            matter: {
              include: {
                client: true,
              },
            },
            task: true,
            itActivityAssociations: {
              include: {
                itActivity: {
                  include: {
                    teamMember: true,
                  },
                },
              },
            },
          },
        },
        teamMember: true,
      },
    });

    console.log(`API: POST /timesheets/${teamMemberId}/${startDate}/${dateIncrementType}/copy-from-previous - Successfully copied from previous period`);
    res.json(updatedTimesheet);
  } catch (error) {
    console.error('Error copying timesheet:', error);
    res.status(500).json({ error: 'Failed to copy timesheet' });
  }
});

// Create new task for a matter
router.post('/tasks', async (req: Request<{}, any, {matterId: string, description: string}>, res: Response): Promise<void> => {
  const { matterId, description } = req.body;
  console.log(`API: POST /timesheets/tasks - Creating task: ${description} for matter: ${matterId}`);
  try {

    if (!matterId || !description) {
      res.status(400).json({ error: 'Matter ID and description are required' });
      return;
    }

    // Check if task already exists for this matter
    const existingTask = await prisma.task.findFirst({
      where: {
        matterId,
        description,
      },
    });

    if (existingTask) {
      res.status(400).json({ error: 'Task with this description already exists for this matter' });
      return;
    }

    // Create the new task
    const newTask = await prisma.task.create({
      data: {
        matterId,
        description,
      },
      include: {
        matter: {
          include: {
            client: true,
          },
        },
      },
    });

    console.log(`API: POST /timesheets/tasks - Successfully created task: ${description} (ID: ${newTask.id})`);
    res.json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

export default router;
