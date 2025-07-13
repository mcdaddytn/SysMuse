// src/routes/itActivity.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient, ITActivityType, Urgency, DateIncrementType } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get IT activities with filters
router.get('/', async (req: Request, res: Response) => {
  const { 
    teamMemberId, 
    startDate, 
    endDate, 
    activityType, 
    isAssociated,
    textSearch 
  } = req.query;
  console.log(`API: GET /it-activities - Fetching activities for team member: ${teamMemberId}, period: ${startDate} to ${endDate}`);
  try {

    if (!teamMemberId || !startDate || !endDate) {
      res.status(400).json({ 
        error: 'teamMemberId, startDate, and endDate are required' 
      });
      return;
    }

    // Make date range inclusive on both dates
    // Parse dates in local timezone to avoid UTC conversion issues
    const startDateInclusive = new Date(startDate + 'T00:00:00');
    
    const endDateInclusive = new Date(endDate + 'T23:59:59.999');
    
    const whereClause: any = {
      teamMemberId: teamMemberId as string,
      startDate: {
        gte: startDateInclusive,
        lte: endDateInclusive,
      },
    };

    if (activityType) {
      whereClause.activityType = activityType as ITActivityType;
    }

    if (isAssociated !== undefined) {
      whereClause.isAssociated = isAssociated === 'true';
    }

    if (textSearch) {
      whereClause.OR = [
        {
          title: {
            contains: textSearch as string,
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: textSearch as string,
            mode: 'insensitive'
          }
        }
      ];
    }

    const activities = await prisma.iTActivity.findMany({
      where: whereClause,
      include: {
        teamMember: true,
        timesheetAssociations: {
          include: {
            timesheetEntry: {
              include: {
                matter: {
                  include: {
                    client: true,
                  },
                },
                task: true,
                timesheet: true,
              },
            },
          },
        },
      },
      orderBy: {
        startDate: 'desc',
      },
    });

    console.log(`API: GET /it-activities - Successfully fetched ${activities.length} activities`);
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
        timesheetAssociations: {
          include: {
            timesheetEntry: {
              include: {
                matter: {
                  include: {
                    client: true,
                  },
                },
                task: true,
                timesheet: true,
              },
            },
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
  const { id } = req.params;
  const { 
    matterId, 
    taskId, 
    taskDescription, 
    durationMinutes, 
    urgency = 'MEDIUM',
    timesheetDate,
    timesheetMode = 'DAY'
  } = req.body;
  console.log(`🔄 API: POST /it-activities/${id}/associate - Starting association process`);
  console.log(`📋 API: Request params - id: ${id}`);
  console.log(`📋 API: Request body:`, req.body);
  console.log(`📋 API: Parsed values - matterId: ${matterId}, taskId: ${taskId}, taskDescription: ${taskDescription}, durationMinutes: ${durationMinutes}, urgency: ${urgency}, timesheetDate: ${timesheetDate}, timesheetMode: ${timesheetMode}`);
  
  try {

    if (!matterId || !taskDescription || !durationMinutes || !timesheetDate) {
      console.log(`❌ API: Validation failed - missing required fields`);
      console.log(`❌ API: matterId: ${matterId}, taskDescription: ${taskDescription}, durationMinutes: ${durationMinutes}, timesheetDate: ${timesheetDate}`);
      res.status(400).json({ 
        error: 'matterId, taskDescription, durationMinutes, and timesheetDate are required' 
      });
      return;
    }

    console.log(`✅ API: Validation passed - all required fields present`);

    // Get the activity
    console.log(`🔍 API: Looking up IT activity with id: ${id}`);
    const activity = await prisma.iTActivity.findUnique({
      where: { id },
      include: { teamMember: true },
    });

    console.log(`🔍 API: Found activity:`, activity);

    if (!activity) {
      console.log(`❌ API: IT activity not found with id: ${id}`);
      res.status(404).json({ error: 'IT activity not found' });
      return;
    }

    console.log(`✅ API: IT activity found - teamMemberId: ${activity.teamMemberId}, isAssociated: ${activity.isAssociated}`);

    if (activity.isAssociated) {
      console.log(`❌ API: Activity is already associated`);
      res.status(400).json({ error: 'Activity is already associated with a timesheet entry' });
      return;
    }

    console.log(`✅ API: Activity can be associated`);

    // Parse the timesheet date and adjust for weekly mode
    console.log(`📅 API: Parsing timesheet date: ${timesheetDate} with mode: ${timesheetMode}`);
    let parsedTimesheetDate = new Date(timesheetDate + 'T00:00:00');
    
    // For weekly mode, ensure we're using the Sunday of that week
    if (timesheetMode === 'WEEK') {
      const dayOfWeek = parsedTimesheetDate.getDay();
      if (dayOfWeek !== 0) {
        parsedTimesheetDate.setDate(parsedTimesheetDate.getDate() - dayOfWeek);
      }
    }
    console.log(`📅 API: Adjusted timesheet date:`, parsedTimesheetDate);
    
    // Find or create the timesheet for the specified date
    console.log(`🔍 API: Looking for existing timesheet - teamMemberId: ${activity.teamMemberId}, date: ${parsedTimesheetDate.toISOString()}, mode: ${timesheetMode}`);
    let timesheet = await prisma.timesheet.findFirst({
      where: {
        teamMemberId: activity.teamMemberId,
        startDate: parsedTimesheetDate,
        dateIncrementType: timesheetMode as DateIncrementType,
      },
    });

    console.log(`🔍 API: Found existing timesheet:`, timesheet);

    if (!timesheet) {
      console.log(`📝 API: Creating new ${timesheetMode} timesheet`);
      console.log(`📝 API: Team member details:`, {
        teamMemberId: activity.teamMemberId,
        timeIncrementType: activity.teamMember.timeIncrementType,
        timeIncrement: activity.teamMember.timeIncrement
      });
      
      // Create a new timesheet with the specified mode
      timesheet = await prisma.timesheet.create({
        data: {
          teamMemberId: activity.teamMemberId,
          startDate: parsedTimesheetDate,
          dateIncrementType: timesheetMode as DateIncrementType,
          timeIncrementType: activity.teamMember.timeIncrementType ?? undefined,
          timeIncrement: activity.teamMember.timeIncrement ?? undefined,
        },
      });
      console.log(`✅ API: Created new timesheet:`, timesheet);
    } else {
      console.log(`✅ API: Using existing timesheet with id: ${timesheet.id}`);
    }
    
    // Convert duration to appropriate format based on team member's time increment type
    console.log(`🔄 API: Converting duration based on time increment type: ${activity.teamMember.timeIncrementType}`);
    console.log(`🔄 API: Input duration minutes: ${durationMinutes}`);
    
    let actualTime: number;
    if (activity.teamMember.timeIncrementType === 'PERCENT') {
      console.log(`📊 API: Converting to percentage`);
      
      const workingHours = activity.teamMember.workingHours ?? 0;
      const dailyMinutes = (workingHours / 5) * 60; // Assume 5-day work week
      
      console.log(`📊 API: Working hours: ${workingHours}, daily minutes: ${dailyMinutes}`);

      // Avoid division by 0
      actualTime = dailyMinutes > 0
        ? Math.round((durationMinutes / dailyMinutes) * 100)
        : 0;
        
      console.log(`📊 API: Converted to percentage: ${actualTime}%`);

    } else {
      console.log(`⏱️ API: Keeping as minutes`);
      // Keep as minutes
      actualTime = durationMinutes;
      console.log(`⏱️ API: Actual time in minutes: ${actualTime}`);
    }

    // Check if a timesheet entry already exists for this matter/task combination
    console.log(`🔍 API: Checking for existing timesheet entry - timesheetId: ${timesheet.id}, matterId: ${matterId}, taskDescription: ${taskDescription}`);
    let timesheetEntry = await prisma.timesheetEntry.findFirst({
      where: {
        timesheetId: timesheet.id,
        matterId,
        taskDescription,
      },
    });

    console.log(`🔍 API: Found existing entry:`, timesheetEntry);

    if (timesheetEntry) {
      console.log(`📝 API: Updating existing timesheet entry`);
      console.log(`📝 API: Current actual time: ${timesheetEntry.actualTime}, adding: ${actualTime}`);
      
      // Update existing entry by adding the duration
      timesheetEntry = await prisma.timesheetEntry.update({
        where: { id: timesheetEntry.id },
        data: {
          actualTime: timesheetEntry.actualTime + actualTime,
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
      console.log(`✅ API: Updated existing timesheet entry:`, timesheetEntry);
    } else {
      console.log(`📝 API: Creating new timesheet entry`);
      console.log(`📝 API: Entry data:`, {
        timesheetId: timesheet.id,
        matterId,
        taskId,
        taskDescription,
        urgency,
        actualTime
      });
      
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
        },
        include: {
          matter: {
            include: { client: true },
          },
          task: true,
          timesheet: true,
        },
      });
      console.log(`✅ API: Created new timesheet entry:`, timesheetEntry);
    }

    // Create the association between IT activity and timesheet entry
    console.log(`🔄 API: Creating association between IT activity and timesheet entry`);
    const association = await prisma.iTActivityAssociation.create({
      data: {
        itActivityId: id,
        timesheetEntryId: timesheetEntry.id,
        durationMinutes: durationMinutes,
      },
      include: {
        itActivity: {
          include: {
            teamMember: true,
          },
        },
        timesheetEntry: {
          include: {
            matter: {
              include: { client: true },
            },
            task: true,
            timesheet: true,
          },
        },
      },
    });

    // Update the IT activity to mark it as associated
    console.log(`🔄 API: Updating IT activity to mark as associated`);
    const updatedActivity = await prisma.iTActivity.update({
      where: { id },
      data: {
        isAssociated: true,
      },
      include: {
        teamMember: true,
        timesheetAssociations: {
          include: {
            timesheetEntry: {
              include: {
                matter: {
                  include: { client: true },
                },
                task: true,
                timesheet: true,
              },
            },
          },
        },
      },
    });

    console.log(`✅ API: Successfully updated IT activity:`, updatedActivity);
    
    const responseMessage = timesheetEntry 
      ? 'IT activity successfully associated with timesheet entry' 
      : 'New timesheet entry created from IT activity';
      
    console.log(`✅ API: POST /it-activities/${id}/associate - Successfully associated activity with timesheet entry`);
    console.log(`📤 API: Sending response with message: ${responseMessage}`);
    
    const responseData = {
      activity: updatedActivity,
      timesheetEntry,
      association,
      message: responseMessage
    };
    
    console.log(`📤 API: Response data:`, responseData);
    res.json(responseData);

  } catch (error) {
    console.error('❌ API: Error associating IT activity:', error);
    if (error instanceof Error) {
      console.error('❌ API: Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to associate IT activity' });
  }
});

// Remove association from an IT activity
router.post('/:id/unassociate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { timesheetEntryId } = req.body; // Optional: specific association to remove

    console.log(`🔄 API: POST /it-activities/${id}/unassociate - Starting unassociation process`);

    const activity = await prisma.iTActivity.findUnique({
      where: { id },
      include: { 
        timesheetAssociations: {
          include: {
            timesheetEntry: {
              include: {
                matter: { include: { client: true } },
                task: true,
                timesheet: true,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      res.status(404).json({ error: 'IT activity not found' });
      return;
    }

    if (!activity.isAssociated || activity.timesheetAssociations.length === 0) {
      res.status(400).json({ error: 'Activity is not currently associated' });
      return;
    }

    // If specific timesheetEntryId provided, remove that specific association
    // Otherwise, remove all associations
    let associationsToRemove = activity.timesheetAssociations;
    if (timesheetEntryId) {
      associationsToRemove = activity.timesheetAssociations.filter(
        assoc => assoc.timesheetEntryId === timesheetEntryId
      );
      if (associationsToRemove.length === 0) {
        res.status(400).json({ error: 'Association not found' });
        return;
      }
    }

    console.log(`🔄 API: Removing ${associationsToRemove.length} associations`);

    // Remove associations and update timesheet entries
    for (const association of associationsToRemove) {
      // Subtract the duration from the timesheet entry
      const timesheetEntry = association.timesheetEntry;
      const durationToSubtract = association.durationMinutes || 0;
      
      console.log(`🔄 API: Subtracting ${durationToSubtract} minutes from timesheet entry ${timesheetEntry.id}`);
      
      let newActualTime = timesheetEntry.actualTime;
      
      // Convert duration back to the timesheet's format
      const timesheet = timesheetEntry.timesheet;
      if (timesheet.timeIncrementType === 'PERCENT') {
        // Get team member info from timesheet to calculate percentage
        const teamMember = await prisma.teamMember.findUnique({
          where: { id: timesheet.teamMemberId },
        });
        const workingHours = teamMember?.workingHours ?? 0;
        const dailyMinutes = (workingHours / 5) * 60;
        const percentToSubtract = dailyMinutes > 0 
          ? Math.round((durationToSubtract / dailyMinutes) * 100)
          : 0;
        newActualTime = Math.max(0, timesheetEntry.actualTime - percentToSubtract);
      } else {
        newActualTime = Math.max(0, timesheetEntry.actualTime - durationToSubtract);
      }

      // Update timesheet entry
      await prisma.timesheetEntry.update({
        where: { id: timesheetEntry.id },
        data: { actualTime: newActualTime },
      });

      // Remove the association
      await prisma.iTActivityAssociation.delete({
        where: { id: association.id },
      });
    }

    // Check if any associations remain
    const remainingAssociations = await prisma.iTActivityAssociation.count({
      where: { itActivityId: id },
    });

    // Update the IT activity
    const updatedActivity = await prisma.iTActivity.update({
      where: { id },
      data: {
        isAssociated: remainingAssociations > 0,
      },
      include: {
        teamMember: true,
        timesheetAssociations: {
          include: {
            timesheetEntry: {
              include: {
                matter: { include: { client: true } },
                task: true,
                timesheet: true,
              },
            },
          },
        },
      },
    });

    console.log(`✅ API: Successfully unassociated IT activity`);

    res.json({
      activity: updatedActivity,
      message: `IT activity unassociated successfully. Removed ${associationsToRemove.length} association(s).`
    });

  } catch (error) {
    console.error('❌ API: Error unassociating IT activity:', error);
    if (error instanceof Error) {
      console.error('❌ API: Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to unassociate IT activity' });
  }
});

// Create a manual IT activity (for testing or manual entry)
router.post('/', async (req: Request, res: Response) => {
  const {
    teamMemberId,
    activityType,
    title,
    description,
    startDate,
    endDate,
    metadata,
  } = req.body;
  console.log(`API: POST /it-activities - Creating manual activity: ${title} for team member: ${teamMemberId}`);
  try {

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

    console.log(`API: POST /it-activities - Successfully created activity: ${title} (ID: ${activity.id})`);
    res.json(activity);
  } catch (error) {
    console.error('Error creating IT activity:', error);
    res.status(500).json({ error: 'Failed to create IT activity' });
  }
});

// Get activity statistics for a team member
router.get('/stats/:teamMemberId', async (req: Request, res: Response) => {
  const { teamMemberId } = req.params;
  const { startDate, endDate } = req.query;
  console.log(`API: GET /it-activities/stats/${teamMemberId} - Fetching stats for period: ${startDate} to ${endDate}`);
  try {

    if (!startDate || !endDate) {
      res.status(400).json({ 
        error: 'startDate and endDate are required' 
      });
      return;
    }

    // Make date range inclusive on both dates
    // Parse dates in local timezone to avoid UTC conversion issues
    const startDateInclusive = new Date(startDate + 'T00:00:00');
    
    const endDateInclusive = new Date(endDate + 'T23:59:59.999');
    
    const whereClause = {
      teamMemberId,
      startDate: {
        gte: startDateInclusive,
        lte: endDateInclusive,
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

    const relativityCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'RELATIVITY' },
    });

    const claudeSessionCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'CLAUDE_SESSION' },
    });

    const cocounselSessionCount = await prisma.iTActivity.count({
      where: { ...whereClause, activityType: 'COCOUNSEL_SESSION' },
    });

    // Get associated vs unassociated counts
    const associatedCount = await prisma.iTActivity.count({
      where: { ...whereClause, isAssociated: true },
    });

    const unassociatedCount = await prisma.iTActivity.count({
      where: { ...whereClause, isAssociated: false },
    });

    // Get total duration of associated activities from associations
    const associations = await prisma.iTActivityAssociation.findMany({
      where: {
        itActivity: whereClause,
      },
      select: { durationMinutes: true },
    });

    const totalDurationMinutes = associations.reduce(
      (sum, association) => sum + (association.durationMinutes || 0), 
      0
    );

    console.log(`API: GET /it-activities/stats/${teamMemberId} - Successfully fetched statistics`);
    res.json({
      period: { startDate, endDate },
      activityCounts: {
        calendar: calendarCount,
        email: emailCount,
        document: documentCount,
        relativity: relativityCount,
        claudeSession: claudeSessionCount,
        cocounselSession: cocounselSessionCount,
        total: calendarCount + emailCount + documentCount + relativityCount + claudeSessionCount + cocounselSessionCount,
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