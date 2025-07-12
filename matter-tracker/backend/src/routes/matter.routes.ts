// src/routes/matter.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireAdmin } from './auth.routes';

const router = Router();
const prisma = new PrismaClient();

// Get all matters
router.get('/', requireAuth, async (req: Request, res: Response) => {
  console.log('API: GET /matters - Fetching all matters');
  try {
    const matters = await prisma.matter.findMany({
      include: {
        client: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    console.log(`API: GET /matters - Successfully fetched ${matters.length} matters`);
    res.json(matters);
  } catch (error) {
    console.error('Error fetching matters:', error);
    res.status(500).json({ error: 'Failed to fetch matters' });
  }
});

// Get matter by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: GET /matters/${id} - Fetching matter`);
  try {
    const matter = await prisma.matter.findUnique({
      where: { id },
      include: {
        client: true,
        tasks: true,
      },
    });
    
    if (!matter) {
      return res.status(404).json({ error: 'Matter not found' });
    }
    
    console.log(`API: GET /matters/${id} - Successfully fetched matter: ${matter.name}`);
    res.json(matter);
  } catch (error) {
    console.error('Error fetching matter:', error);
    res.status(500).json({ error: 'Failed to fetch matter' });
  }
});

// Create new matter (admin only)
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { name, description, clientId, clientName } = req.body;
  console.log(`API: POST /matters - Creating matter: ${name}`);
  
  if (!name) {
    return res.status(400).json({ error: 'Matter name is required' });
  }
  
  try {
    let finalClientId = clientId;
    
    // If clientName is provided but no clientId, find or create client
    if (clientName && !clientId) {
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
      finalClientId = client.id;
    }
    
    if (!finalClientId) {
      return res.status(400).json({ error: 'Client is required' });
    }

    // Check if matter already exists for this client
    const existingMatter = await prisma.matter.findFirst({
      where: { 
        name: { equals: name, mode: 'insensitive' },
        clientId: finalClientId
      },
    });
    
    if (existingMatter) {
      return res.status(400).json({ error: 'Matter with this name already exists for this client' });
    }

    const matter = await prisma.matter.create({
      data: {
        name,
        description: description || null,
        clientId: finalClientId,
      },
      include: {
        client: true,
      },
    });

    console.log(`API: POST /matters - Successfully created matter: ${name} (ID: ${matter.id})`);
    res.json(matter);
  } catch (error) {
    console.error('Error creating matter:', error);
    res.status(500).json({ error: 'Failed to create matter' });
  }
});

// Update matter (admin only)
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, clientId } = req.body;
  console.log(`API: PUT /matters/${id} - Updating matter`);
  
  if (!name || !clientId) {
    return res.status(400).json({ error: 'Matter name and client are required' });
  }
  
  try {
    // Check if matter exists
    const existingMatter = await prisma.matter.findUnique({
      where: { id },
    });
    
    if (!existingMatter) {
      return res.status(404).json({ error: 'Matter not found' });
    }
    
    // Check if another matter has the same name for this client
    const duplicateMatter = await prisma.matter.findFirst({
      where: { 
        name: { equals: name, mode: 'insensitive' },
        clientId,
        id: { not: id }
      },
    });
    
    if (duplicateMatter) {
      return res.status(400).json({ error: 'Matter with this name already exists for this client' });
    }
    
    const matter = await prisma.matter.update({
      where: { id },
      data: {
        name,
        description: description || null,
        clientId,
      },
      include: {
        client: true,
      },
    });

    console.log(`API: PUT /matters/${id} - Successfully updated matter: ${name}`);
    res.json(matter);
  } catch (error) {
    console.error('Error updating matter:', error);
    res.status(500).json({ error: 'Failed to update matter' });
  }
});

// Delete matter (admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: DELETE /matters/${id} - Deleting matter`);
  
  try {
    // Check if matter exists
    const existingMatter = await prisma.matter.findUnique({
      where: { id },
      include: {
        tasks: true,
        entries: true,
      },
    });
    
    if (!existingMatter) {
      return res.status(404).json({ error: 'Matter not found' });
    }
    
    // Check if matter has associated entries or tasks
    if (existingMatter.entries.length > 0 || existingMatter.tasks.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete matter with associated timesheet entries or tasks. Please delete them first.' 
      });
    }
    
    await prisma.matter.delete({
      where: { id },
    });

    console.log(`API: DELETE /matters/${id} - Successfully deleted matter: ${existingMatter.name}`);
    res.json({ message: 'Matter deleted successfully' });
  } catch (error) {
    console.error('Error deleting matter:', error);
    res.status(500).json({ error: 'Failed to delete matter' });
  }
});

export default router;

