// src/routes/itActivity.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient, ITActivityType, Urgency } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get IT activities with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const { 
      teamMemberId, 
      startDate, 
      endDate, 
      activityType, 
      isAssociated 
    } = req.query;

    if (!teamMemberId || !startDate || !endDate) {
      res.status(400).json({ 
        error: 'teamMemberId, startDate, and endDate are required' 
      });
      return;
    }

    const whereClause: any = {
      teamMemberId: teamMemberId as string,
      startDate: {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      },
    };

    if (activityType) {
      whereClause.activityType = activityType as ITActivityType;
    }

    if (isAssociated !== undefined) {
      whereClause.isAssociated = isAssociated === 'true';
    }

    const activities = await prisma.iTActivity.findMany({
      where: whereClause,
      include: {
        teamMember: true,
        matter: {
          include: {
            client: true,
          },
        },
        task: true,
        timesheetEntries: {
          include: {
            timesheet: true,
          },
        },
      },
      orderBy: {
        startDate: 'desc',
      },
    });

    res.json(activities);
  } catch (error) {
    console.error('Error fetching IT activities:', error);
    res.status(500).json({ error: 'Failed to fetch IT activities' });
  }
});

// Get a specific IT activity by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const activity = await prisma.iTActivity.findUnique({
      where: { id },
      include: {
        teamMember: true,
        matter: {
          include: {
            client: true,
          },
        },
        task: true,
        timesheetEntries: {
          include: {
            timesheet: true,
          },
        },
      },
    });

    if (!activity) {
      res.status(404).json({ error: 'IT activity not found' });
      return;
    }

    res.json(activity);
  } catch (error) {
    console.error('Error fetching IT activity:', error);
    res.status(500).json({ error: 'Failed to fetch IT activity' });
  }
});

// Associate an IT activity with a matter and task, creating a timesheet entry
router.post('/:id/associate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      matterId, 
      taskId, 
      taskDescription, 
      durationMinutes, 
      urgency = 'MEDIUM',
      timesheetDate 
    } = req.body;

    if (!matterId || !taskDescription || !durationMinutes || !timesheetDate) {
      res.status(400).json({ 
        error: 'matterId, taskDescription, durationMinutes, and timesheetDate are required' 
      });
      return;
    }

    // Get the activity
    const activity = await prisma.iTActivity.findUnique({
      where: { id },
      include: { teamMember: true },
    });

    if (!activity) {
      res.status(404).json({ error: 'IT activity not found' });
      return;
    }

    if (activity.isAssociated) {
      res.status(400).json({ error: 'Activity is already associated with a timesheet entry' });
      return;
    }

    // Parse the timesheet date
    const parsedTimesheetDate = new Date(timesheetDate + 'T00:00:00');
    
    // Find or create the timesheet for the specified date
    let timesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId: activity.teamMemberId,
        startDate: parsedTimesheetDate,
        dateIncrementType: 'DAY', // Default to daily for IT activity associations
      },
    });

    if (!timesheet) {
      // Create a new daily timesheet
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId: activity.teamMemberId,
          startDate: parsedTimesheetDate,
          dateIncrementType: 'DAY',
          timeIncrementType: activity.teamMember.timeIncrementType ?? undefined,
          timeIncrement: activity.teamMember.timeIncrement ?? undefined,
        },
      });
    }
    
    // Convert duration to appropriate format based on team member's time increment type
    let actualTime: number;
    if (activity.teamMember.timeIncrementType === 'PERCENT') {
    
      const workingHours = activity.teamMember.workingHours ?? 0;
      const dailyMinutes = (workingHours / 5) * 60; // Assume 5-day work week

      // Avoid division by 0
      actualTime = dailyMinutes > 0
        ? Math.round((durationMinutes / dailyMinutes) * 100)
        : 0;

    } else {
      // Keep as minutes
      actualTime = durationMinutes;
    }

    // Check if a timesheet entry already exists for this matter/task combination
    const existingEntry = await prisma.timesheetEntry.findFirst({
      where: {
        timesheetId: timesheet.id,
        matterId,
        taskDescription,
      },
    });

    let timesheetEntry;
    if (existingEntry) {
      // Update existing entry by adding the duration
      timesheetEntry = await prisma.timesheetEntry.update({
        where: { id: existingEntry.id },
        data: {
          actualTime: existingEntry.actualTime + actualTime,
          updatedAt: new Date(),
        },
        include: {
          matter: {
            include: { client: true },
          },
          task: true,
          timesheet: true,
        },
      });
    } else {
      // Create new timesheet entry
      timesheetEntry = await prisma.timesheetEntry.create({
        data: {
          timesheetId: timesheet.id,
          matterId,
          taskId,
          taskDescription,
          urgency: urgency as Urgency,
          projectedTime: 0, // Leave projected time as 0
          actualTime,
          sourceITActivityId: id,
        },
        include: {
          matter: {
            include: { client: true },
          },
          task: true,
          timesheet: true,
        },
      });
    }

    // Update the IT activity to mark it as associated
    const updatedActivity = await prisma.iTActivity.update({
      where: { id },
      data: {
        matterId,
        taskId,
        durationMinutes,
        isAssociated: true,
      },
      include: {
        teamMember: true,
        matter: {
          include: { client: true },
        },
        task: true,
        timesheetEntries: true,
      },
    });

    res.json({
      activity: updatedActivity,
      timesheetEntry,
      message: existingEntry 
        ? 'Duration added to existing timesheet entry' 
        : 'New timesheet entry created from IT activity'
    });

  } catch (error) {
    console.error('Error associating IT activity:', error);
    res.status(500).json({ error: 'Failed to associate IT activity' });
  }
});

// Remove association from an IT activity
router.post('/:id/unassociate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const activity = await prisma.iTActivity.findUnique({
      where: { id },
      include: { timesheetEntries: true },
    });

    if (!activity) {
      res.status(404).json({ error: 'IT activity not found' });
      return;
    }

    if (!activity.isAssociated) {
      res.status(400).json({ error: 'Activity is not currently associated' });
      return;
    }

    // If there are associated timesheet entries, we need to handle them carefully
    // For now, we'll just unmark the activity but leave the timesheet entries
    // In a production system, you might want to decrease the actual time or delete the entries
    
    const updatedActivity = await prisma.iTActivity.update({
      where: { id },
      data: {
        matterId: null,
        taskId: null,
        durationMinutes: null,
        isAssociated: false,
      },
      include: {
        teamMember: true,
        matter: {
          include: { client: true },
        },
        task: true,
      },
    });

    res.json({
      activity: updatedActivity,
      message: 'IT activity unassociated successfully'
    });

  } catch (error) {
    console.error('Error unassociating IT activity:', error);
    res.status(500).json({ error: 'Failed to unassociate IT activity' });
  }
});

// Create a manual IT activity (for testing or manual entry)
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      teamMemberId,
      activityType,
      title,
      description,
      startDate,
      endDate,
      metadata,
    } = req.body;

    if (!teamMemberId || !activityType || !title || !startDate) {
      res.status(400).json({ 
        error: 'teamMemberId, activityType, title, and startDate are required' 
      });
      return;
    }

    const activity = await prisma.iTActivity.create({
      data: {
        teamMemberId,
        activityType: activityType as ITActivityType,
        title,
        description,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        metadata: metadata || {},
        isAssociated: false,
      },
      include: {
        teamMember: true,
      },
    });

    res.json(activity);
  } catch (error) {
    console.error('Error creating IT activity:', error);
    res.status(500).json({ error: 'Failed to create IT activity' });
  }
});

// Get activity statistics for a team member
router.get('/stats/:teamMemberId', async (req: Request, res: Response) => {
  try {
    const { teamMemberId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({ 
        error: 'startDate and endDate are required' 
      });
      return;
    }

    const whereClause = {
      teamMemberId,
      startDate: {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      },
    };

    // Get counts by activity type
    const calendarCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'CALENDAR' },
    });

    const emailCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'EMAIL' },
    });

    const documentCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'DOCUMENT' },
    });

    // Get associated vs unassociated counts
    const associatedCount = await prisma.iTActivity.count({
      where: { ...whereClause, isAssociated: true },
    });

    const unassociatedCount = await prisma.iTActivity.count({
      where: { ...whereClause, isAssociated: false },
    });

    // Get total duration of associated activities
    const associatedActivities = await prisma.iTActivity.findMany({
      where: { 
        ...whereClause, 
        isAssociated: true,
        durationMinutes: { not: null },
      },
      select: { durationMinutes: true },
    });

    const totalDurationMinutes = associatedActivities.reduce(
      (sum, activity) => sum + (activity.durationMinutes || 0), 
      0
    );

    res.json({
      period: { startDate, endDate },
      activityCounts: {
        calendar: calendarCount,
        email: emailCount,
        document: documentCount,
        total: calendarCount + emailCount + documentCount,
      },
      associationStatus: {
        associated: associatedCount,
        unassociated: unassociatedCount,
        associationRate: unassociatedCount > 0 
          ? Math.round((associatedCount / (associatedCount + unassociatedCount)) * 100) 
          : 0,
      },
      totalDuration: {
        minutes: totalDurationMinutes,
        hours: Math.round((totalDurationMinutes / 60) * 100) / 100,
      },
    });

  } catch (error) {
    console.error('Error fetching IT activity stats:', error);
    res.status(500).json({ error: 'Failed to fetch IT activity statistics' });
  }
});

export default router;