// src/routes/teamMember.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from './auth.routes';

const router = Router();
const prisma = new PrismaClient();

// Get all team members
router.get('/', requireAuth, async (req: Request, res: Response) => {
  console.log('API: GET /team-members - Fetching all team members');
  try {
    const teamMembers = await prisma.teamMember.findMany({
      orderBy: {
        name: 'asc',
      },
    });
    console.log(`API: GET /team-members - Successfully fetched ${teamMembers.length} team members`);
    res.json(teamMembers);
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

export default router;
