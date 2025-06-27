// src/routes/task.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get tasks by matter
router.get('/matter/:matterId', async (req: Request, res: Response) => {
  try {
    const { matterId } = req.params;
    const tasks = await prisma.task.findMany({
      where: { matterId },
      orderBy: {
        description: 'asc',
      },
    });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

export default router;