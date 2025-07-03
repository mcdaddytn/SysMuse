// src/routes/teamMember.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all team members
router.get('/', async (req: Request, res: Response) => {
  try {
    const teamMembers = await prisma.teamMember.findMany({
      orderBy: {
        name: 'asc',
      },
    });
    res.json(teamMembers);
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

export default router;
