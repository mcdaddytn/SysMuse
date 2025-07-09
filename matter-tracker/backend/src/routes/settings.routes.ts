// src/routes/settings.routes.ts
import { Router, Request, Response } from 'express';
import { PrismaClient, MatterLookaheadMode, TimesheetMode } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all settings
router.get('/', async (req: Request, res: Response) => {
  console.log('API: GET /settings - Fetching all settings');
  try {
    const settings = await prisma.settings.findMany({
      orderBy: {
        key: 'asc'
      }
    });
    
    // Convert to key-value object with defaults
    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, any>);
    
    // Add default values for missing settings
    if (!settingsObj.matterLookaheadMode) {
      settingsObj.matterLookaheadMode = MatterLookaheadMode.INDIVIDUAL_STARTS_WITH;
    }
    if (!settingsObj.timesheetMode) {
      settingsObj.timesheetMode = TimesheetMode.WEEKLY;
    }
    
    console.log(`API: GET /settings - Successfully fetched ${settings.length} settings`);
    res.json(settingsObj);
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
      // Return default values for known settings
      const defaultValue = getDefaultValue(key);
      if (defaultValue !== null) {
        res.json({ key, value: defaultValue });
        return;
      }
      
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    
    console.log(`API: GET /settings/${key} - Successfully fetched setting`);
    res.json({ key: setting.key, value: setting.value });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Update or create setting
router.put('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value, description } = req.body;
  console.log(`API: PUT /settings/${key} - Updating setting with value:`, value);
  
  try {
    // Validate the setting key and value
    if (!isValidSetting(key, value)) {
      res.status(400).json({ error: 'Invalid setting key or value' });
      return;
    }
    
    const setting = await prisma.settings.upsert({
      where: { key },
      update: {
        value,
        description: description || undefined,
        updatedAt: new Date()
      },
      create: {
        key,
        value,
        description: description || undefined
      }
    });
    
    console.log(`API: PUT /settings/${key} - Successfully updated setting`);
    res.json(setting);
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Delete setting
router.delete('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  console.log(`API: DELETE /settings/${key} - Deleting setting`);
  
  try {
    await prisma.settings.delete({
      where: { key }
    });
    
    console.log(`API: DELETE /settings/${key} - Successfully deleted setting`);
    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

// Helper function to get default values
function getDefaultValue(key: string): any {
  switch (key) {
    case 'matterLookaheadMode':
      return MatterLookaheadMode.INDIVIDUAL_STARTS_WITH;
    case 'timesheetMode':
      return TimesheetMode.WEEKLY;
    default:
      return null;
  }
}

// Helper function to validate settings
function isValidSetting(key: string, value: any): boolean {
  switch (key) {
    case 'matterLookaheadMode':
      return Object.values(MatterLookaheadMode).includes(value);
    case 'timesheetMode':
      return Object.values(TimesheetMode).includes(value);
    default:
      return true; // Allow other settings
  }
}

export default router;