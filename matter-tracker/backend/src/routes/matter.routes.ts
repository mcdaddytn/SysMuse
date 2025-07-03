// src/routes/matter.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all matters
router.get('/', async (req: Request, res: Response) => {
  try {
    const matters = await prisma.matter.findMany({
      include: {
        client: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    res.json(matters);
  } catch (error) {
    console.error('Error fetching matters:', error);
    res.status(500).json({ error: 'Failed to fetch matters' });
  }
});

// Create new matter
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, clientName } = req.body;

    // Find or create client
    let client = await prisma.client.findFirst({
      where: { name: clientName },
    });

    if (!client) {
      client = await prisma.client.create({
        data: {
          name: clientName,
          description: '',
        },
      });
    }

    const matter = await prisma.matter.create({
      data: {
        name,
        description,
        clientId: client.id,
      },
      include: {
        client: true,
      },
    });

    res.json(matter);
  } catch (error) {
    console.error('Error creating matter:', error);
    res.status(500).json({ error: 'Failed to create matter' });
  }
});

export default router;

