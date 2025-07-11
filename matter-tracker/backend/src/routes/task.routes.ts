// src/routes/task.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get tasks by matter
router.get('/matter/:matterId', async (req: Request, res: Response) => {
  const { matterId } = req.params;
  console.log(`API: GET /tasks/matter/${matterId} - Fetching tasks for matter`);
  try {
    const tasks = await prisma.task.findMany({
      where: { matterId },
      orderBy: {
        description: 'asc',
      },
    });
    console.log(`API: GET /tasks/matter/${matterId} - Successfully fetched ${tasks.length} tasks`);
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

export default router;