// src/routes/settings.routes.ts
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all settings
router.get('/', async (req: Request, res: Response) => {
  console.log('API: GET /settings - Fetching all settings');
  try {
    const settings = await prisma.settings.findMany();
    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, any>);
    
    console.log(`API: GET /settings - Successfully fetched ${settings.length} settings`);
    res.json(settingsMap);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get a specific setting
router.get('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  console.log(`API: GET /settings/${key} - Fetching setting`);
  try {
    const setting = await prisma.settings.findUnique({ where: { key } });
    
    if (!setting) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    
    console.log(`API: GET /settings/${key} - Successfully fetched setting`);
    res.json(setting);
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

export default router;