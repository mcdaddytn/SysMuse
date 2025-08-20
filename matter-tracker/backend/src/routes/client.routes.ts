// src/routes/client.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireAdmin } from './auth.routes';

const router = Router();
const prisma = new PrismaClient();

// Get all clients
router.get('/', requireAuth, async (req: Request, res: Response) => {
  console.log('API: GET /clients - Fetching all clients');
  try {
    const clients = await prisma.client.findMany({
      orderBy: {
        name: 'asc',
      },
    });
    console.log(`API: GET /clients - Successfully fetched ${clients.length} clients`);
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Get client by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: GET /clients/${id} - Fetching client`);
  try {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        matters: true,
      },
    });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    console.log(`API: GET /clients/${id} - Successfully fetched client: ${client.name}`);
    res.json(client);
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Create new client (admin only)
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { name, description } = req.body;
  console.log(`API: POST /clients - Creating client: ${name}`);
  
  if (!name) {
    return res.status(400).json({ error: 'Client name is required' });
  }
  
  try {
    // Check if client already exists
    const existingClient = await prisma.client.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    
    if (existingClient) {
      return res.status(400).json({ error: 'Client with this name already exists' });
    }
    
    const client = await prisma.client.create({
      data: {
        name,
        description: description || null,
      },
    });

    console.log(`API: POST /clients - Successfully created client: ${name} (ID: ${client.id})`);
    res.json(client);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client (admin only)
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description } = req.body;
  console.log(`API: PUT /clients/${id} - Updating client`);
  
  if (!name) {
    return res.status(400).json({ error: 'Client name is required' });
  }
  
  try {
    // Check if client exists
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });
    
    if (!existingClient) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Check if another client has the same name
    const duplicateClient = await prisma.client.findFirst({
      where: { 
        name: { equals: name, mode: 'insensitive' },
        id: { not: id }
      },
    });
    
    if (duplicateClient) {
      return res.status(400).json({ error: 'Client with this name already exists' });
    }
    
    const client = await prisma.client.update({
      where: { id },
      data: {
        name,
        description: description || null,
      },
    });

    console.log(`API: PUT /clients/${id} - Successfully updated client: ${name}`);
    res.json(client);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete client (admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: DELETE /clients/${id} - Deleting client`);
  
  try {
    // Check if client exists
    const existingClient = await prisma.client.findUnique({
      where: { id },
      include: {
        matters: true,
      },
    });
    
    if (!existingClient) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Check if client has associated matters
    if (existingClient.matters.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete client with associated matters. Please delete all matters first.' 
      });
    }
    
    await prisma.client.delete({
      where: { id },
    });

    console.log(`API: DELETE /clients/${id} - Successfully deleted client: ${existingClient.name}`);
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

export default router;