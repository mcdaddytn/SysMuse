// src/routes/timesheet.routes.ts

import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient, Urgency, TimeIncrementType, DateIncrementType } from '@prisma/client';

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
router.get('/:teamMemberId/:startDate/:dateIncrementType', async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, startDate, dateIncrementType } = req.params;
    
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
          },
        },
        teamMember: true,
      },
    });

    if (!timesheet) {
      // Create empty timesheet if it doesn't exist, using team member's defaults
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          startDate: parsedStartDate,
          dateIncrementType: dateIncrementType as DateIncrementType,
          timeIncrementType: teamMember.timeIncrementType,
          timeIncrement: teamMember.timeIncrement,
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
            },
          },
          teamMember: true,
        },
      });
    }

    res.json(timesheet);
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// Save or update timesheet entries
router.post('/:teamMemberId/:startDate/:dateIncrementType', async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}, any, TimesheetInput>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, startDate, dateIncrementType } = req.params;
    const { entries, dateIncrementType: bodyDateIncrementType, timeIncrementType, timeIncrement } = req.body;
    
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
          timeIncrementType,
          timeIncrement,
        },
      });
    } else {
      // Update timesheet settings
      timesheet = await prisma.timesheet.update({
        where: { id: timesheet.id },
        data: {
          timeIncrementType,
          timeIncrement,
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
          },
        },
        teamMember: true,
      },
    });

    res.json(updatedTimesheet);
  } catch (error) {
    console.error('Error saving timesheet:', error);
    res.status(500).json({ error: 'Failed to save timesheet' });
  }
});

// Copy timesheet from previous period
router.post('/:teamMemberId/:startDate/:dateIncrementType/copy-from-previous', async (req: Request<{teamMemberId: string, startDate: string, dateIncrementType: string}>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, startDate, dateIncrementType } = req.params;
    
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
          },
        },
        teamMember: true,
      },
    });

    res.json(updatedTimesheet);
  } catch (error) {
    console.error('Error copying timesheet:', error);
    res.status(500).json({ error: 'Failed to copy timesheet' });
  }
});

// Create new task for a matter
router.post('/tasks', async (req: Request<{}, any, {matterId: string, description: string}>, res: Response): Promise<void> => {
  try {
    const { matterId, description } = req.body;

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

    res.json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

export default router;
