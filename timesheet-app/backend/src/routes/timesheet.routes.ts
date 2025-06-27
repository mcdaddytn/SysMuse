// src/routes/timesheet.routes.ts

import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient, Urgency } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

interface TimesheetEntryInput {
  matterId: string;
  taskDescription: string;
  urgency: Urgency;
  projectedHours: number;
  actualHours: number;
}

// Get timesheet for a specific team member and week
router.get('/:teamMemberId/:weekStartDate', async (req: Request<{teamMemberId: string, weekStartDate: string}>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, weekStartDate } = req.params;
    const startDate = new Date(weekStartDate);
    
    // Ensure the date is a Sunday
    const day = startDate.getDay();
    if (day !== 0) {
      res.status(400).json({ error: 'Week start date must be a Sunday' });
      return;
    }

    let timesheet = await prisma.timesheet.findUnique({
      where: {
        teamMemberId_weekStartDate: {
          teamMemberId,
          weekStartDate: startDate,
        },
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
      // Create empty timesheet if it doesn't exist
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          weekStartDate: startDate,
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
router.post('/:teamMemberId/:weekStartDate', async (req: Request<{teamMemberId: string, weekStartDate: string}, any, {entries: TimesheetEntryInput[]}>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, weekStartDate } = req.params;
    const { entries } = req.body;
    const startDate = new Date(weekStartDate);

    // Validate that the date is a Sunday
    const day = startDate.getDay();
    if (day !== 0) {
      res.status(400).json({ error: 'Week start date must be a Sunday' });
      return;
    }

    // Validate percentages - now just warn, don't block
    const projectedSum = entries.reduce((sum, entry) => sum + entry.projectedHours, 0);
    const actualSum = entries.reduce((sum, entry) => sum + entry.actualHours, 0);

    // We'll accept any values but could log a warning
    if (projectedSum !== 100 || actualSum !== 100) {
      console.warn(`Warning: Hours don't sum to 100% - Projected: ${projectedSum}%, Actual: ${actualSum}%`);
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
    let timesheet = await prisma.timesheet.findUnique({
      where: {
        teamMemberId_weekStartDate: {
          teamMemberId,
          weekStartDate: startDate,
        },
      },
    });

    if (!timesheet) {
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          weekStartDate: startDate,
        },
      });
    }

    // Delete existing entries and create new ones (simpler than updating)
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
        projectedHours: entry.projectedHours,
        actualHours: entry.actualHours,
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

// Copy timesheet from previous week
router.post('/:teamMemberId/:weekStartDate/copy-from-previous', async (req: Request<{teamMemberId: string, weekStartDate: string}>, res: Response): Promise<void> => {
  try {
    const { teamMemberId, weekStartDate } = req.params;
    const currentWeekStart = new Date(weekStartDate);
    
    // Calculate previous week start date
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);

    // Get previous week's timesheet
    const previousTimesheet = await prisma.timesheet.findUnique({
      where: {
        teamMemberId_weekStartDate: {
          teamMemberId,
          weekStartDate: previousWeekStart,
        },
      },
      include: {
        entries: true,
      },
    });

    if (!previousTimesheet || previousTimesheet.entries.length === 0) {
      res.status(404).json({ error: 'No previous week data found to copy' });
      return;
    }

    // Create or get current week's timesheet
    let currentTimesheet = await prisma.timesheet.findUnique({
      where: {
        teamMemberId_weekStartDate: {
          teamMemberId,
          weekStartDate: currentWeekStart,
        },
      },
    });

    if (!currentTimesheet) {
      currentTimesheet = await prisma.timesheet.create({
        data: {
          teamMemberId,
          weekStartDate: currentWeekStart,
        },
      });
    }

    // Delete existing entries in current week
    await prisma.timesheetEntry.deleteMany({
      where: { timesheetId: currentTimesheet.id },
    });

    // Copy entries from previous week
    await prisma.timesheetEntry.createMany({
      data: previousTimesheet.entries.map(entry => ({
        timesheetId: currentTimesheet!.id,
        matterId: entry.matterId,
        taskDescription: entry.taskDescription,
        urgency: entry.urgency,
        projectedHours: entry.projectedHours,
        actualHours: 0, // Reset actual hours for new week
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

export default router;

