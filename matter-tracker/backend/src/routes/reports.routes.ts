// src/routes/reports.routes.ts

import express, { Request, Response } from 'express';
import { PrismaClient, Urgency } from '@prisma/client';
import { requireAuth } from './auth.routes';

const router = express.Router();
const prisma = new PrismaClient();

interface TimesheetEntryDetail {
  matterName: string;
  clientName: string;
  taskDescription: string;
  urgency: string;
  projectedTime: number;
  actualTime: number;
}

interface TeamSummaryData {
  teamMemberName: string;
  projectedTotal: number;
  actualTotal: number;
  hotProjected: number;
  hotActual: number;
  mediumProjected: number;
  mediumActual: number;
  mildProjected: number;
  mildActual: number;
  timesheetDetails: TimesheetEntryDetail[];
}

// Get team summary report for a specific week
router.get('/team-summary/:startDate', requireAuth, async (req: Request<{startDate: string}>, res: Response): Promise<void> => {
  const { startDate } = req.params;
  console.log(`API: GET /reports/team-summary/${startDate} - Fetching team summary report`);
  
  try {
    // Parse date ensuring it's treated as local date
    const parsedStartDate = new Date(startDate + 'T00:00:00');
    
    // Validate that the date is a Sunday (weekly reports only)
    const day = parsedStartDate.getDay();
    if (day !== 0) {
      console.log(`Date ${startDate} is not a Sunday (day: ${day})`);
      res.status(400).json({ error: 'Report start date must be a Sunday' });
      return;
    }

    // Get all team members
    const teamMembers = await prisma.teamMember.findMany({
      orderBy: { name: 'asc' }
    });

    // Get all timesheets for the specified week
    const timesheets = await prisma.timesheet.findMany({
      where: {
        startDate: parsedStartDate,
        dateIncrementType: 'WEEK'
      },
      include: {
        entries: {
          include: {
            matter: {
              include: {
                client: true
              }
            }
          }
        },
        teamMember: true
      }
    });

    // Process data for each team member
    const reportData: TeamSummaryData[] = teamMembers.map(member => {
      const timesheet = timesheets.find(ts => ts.teamMemberId === member.id);
      
      if (!timesheet || !timesheet.entries.length) {
        // No timesheet data for this member
        return {
          teamMemberName: member.name,
          projectedTotal: 0,
          actualTotal: 0,
          hotProjected: 0,
          hotActual: 0,
          mediumProjected: 0,
          mediumActual: 0,
          mildProjected: 0,
          mildActual: 0,
          timesheetDetails: []
        };
      }

      // Calculate totals by urgency
      const totals = timesheet.entries.reduce((acc, entry) => {
        // Convert percentage to minutes if needed
        let projectedMinutes = entry.projectedTime;
        let actualMinutes = entry.actualTime;
        
        if (timesheet.timeIncrementType === 'PERCENT') {
          // Convert percentage to minutes based on working hours
          const workingMinutes = (member.workingHours || 40) * 60;
          projectedMinutes = (entry.projectedTime / 100) * workingMinutes;
          actualMinutes = (entry.actualTime / 100) * workingMinutes;
        }

        acc.projectedTotal += projectedMinutes;
        acc.actualTotal += actualMinutes;

        switch (entry.urgency) {
          case 'HOT':
            acc.hotProjected += projectedMinutes;
            acc.hotActual += actualMinutes;
            break;
          case 'MEDIUM':
            acc.mediumProjected += projectedMinutes;
            acc.mediumActual += actualMinutes;
            break;
          case 'MILD':
            acc.mildProjected += projectedMinutes;
            acc.mildActual += actualMinutes;
            break;
        }

        return acc;
      }, {
        projectedTotal: 0,
        actualTotal: 0,
        hotProjected: 0,
        hotActual: 0,
        mediumProjected: 0,
        mediumActual: 0,
        mildProjected: 0,
        mildActual: 0
      });

      // Create detailed timesheet entries for popup
      const timesheetDetails: TimesheetEntryDetail[] = timesheet.entries.map(entry => {
        // Convert percentage to minutes if needed
        let projectedMinutes = entry.projectedTime;
        let actualMinutes = entry.actualTime;
        
        if (timesheet.timeIncrementType === 'PERCENT') {
          const workingMinutes = (member.workingHours || 40) * 60;
          projectedMinutes = (entry.projectedTime / 100) * workingMinutes;
          actualMinutes = (entry.actualTime / 100) * workingMinutes;
        }

        return {
          matterName: entry.matter.name,
          clientName: entry.matter.client.name,
          taskDescription: entry.taskDescription,
          urgency: entry.urgency,
          projectedTime: projectedMinutes,
          actualTime: actualMinutes
        };
      });

      return {
        teamMemberName: member.name,
        ...totals,
        timesheetDetails
      };
    });

    // Filter out team members with no data (optional - you might want to show them with zeros)
    const filteredData = reportData.filter(data => 
      data.projectedTotal > 0 || data.actualTotal > 0
    );

    console.log(`API: GET /reports/team-summary/${startDate} - Successfully fetched team summary with ${filteredData.length} team members`);
    res.json(filteredData);
  } catch (error) {
    console.error('Error fetching team summary report:', error);
    res.status(500).json({ error: 'Failed to fetch team summary report' });
  }
});

export default router;