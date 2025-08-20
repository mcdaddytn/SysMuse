// src/routes/teamMember.routes.ts

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { requireAuth, requireAdmin } from './auth.routes';

const router = Router();
const prisma = new PrismaClient();

// Get all team members
router.get('/', requireAuth, async (req: Request, res: Response) => {
  console.log('API: GET /team-members - Fetching all team members');
  try {
    const teamMembers = await prisma.teamMember.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        role: true,
        accessLevel: true,
        workingHours: true,
        timeIncrementType: true,
        timeIncrement: true,
        userITActivity: true,
        lastLoginAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
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

// Get team member by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: GET /team-members/${id} - Fetching team member`);
  try {
    const teamMember = await prisma.teamMember.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        role: true,
        accessLevel: true,
        workingHours: true,
        timeIncrementType: true,
        timeIncrement: true,
        userITActivity: true,
        lastLoginAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    
    if (!teamMember) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    console.log(`API: GET /team-members/${id} - Successfully fetched team member: ${teamMember.name}`);
    res.json(teamMember);
  } catch (error) {
    console.error('Error fetching team member:', error);
    res.status(500).json({ error: 'Failed to fetch team member' });
  }
});

// Create new team member (admin only)
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { 
    name, 
    email, 
    password, 
    title, 
    role, 
    accessLevel, 
    workingHours, 
    timeIncrementType, 
    timeIncrement,
    userITActivity,
    isActive 
  } = req.body;
  
  console.log(`API: POST /team-members - Creating team member: ${name}`);
  
  if (!name || !email || !password || !role || !accessLevel) {
    return res.status(400).json({ error: 'Name, email, password, role, and access level are required' });
  }
  
  try {
    // Check if email already exists
    const existingTeamMember = await prisma.teamMember.findUnique({
      where: { email: email.toLowerCase() },
    });
    
    if (existingTeamMember) {
      return res.status(400).json({ error: 'Team member with this email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const teamMember = await prisma.teamMember.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        title: title || null,
        role,
        accessLevel,
        workingHours: workingHours || null,
        timeIncrementType: timeIncrementType || null,
        timeIncrement: timeIncrement || null,
        userITActivity: userITActivity !== undefined ? userITActivity : null,
        isActive: isActive !== undefined ? isActive : true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        role: true,
        accessLevel: true,
        workingHours: true,
        timeIncrementType: true,
        timeIncrement: true,
        userITActivity: true,
        lastLoginAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    console.log(`API: POST /team-members - Successfully created team member: ${name} (ID: ${teamMember.id})`);
    res.json(teamMember);
  } catch (error) {
    console.error('Error creating team member:', error);
    res.status(500).json({ error: 'Failed to create team member' });
  }
});

// Update team member (admin only)
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    name, 
    email, 
    password, 
    title, 
    role, 
    accessLevel, 
    workingHours, 
    timeIncrementType, 
    timeIncrement,
    userITActivity,
    isActive 
  } = req.body;
  
  console.log(`API: PUT /team-members/${id} - Updating team member`);
  
  if (!name || !email || !role || !accessLevel) {
    return res.status(400).json({ error: 'Name, email, role, and access level are required' });
  }
  
  try {
    // Check if team member exists
    const existingTeamMember = await prisma.teamMember.findUnique({
      where: { id },
    });
    
    if (!existingTeamMember) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    // Check if another team member has the same email
    const duplicateTeamMember = await prisma.teamMember.findFirst({
      where: { 
        email: { equals: email.toLowerCase(), mode: 'insensitive' },
        id: { not: id }
      },
    });
    
    if (duplicateTeamMember) {
      return res.status(400).json({ error: 'Team member with this email already exists' });
    }
    
    // Prepare update data
    const updateData: any = {
      name,
      email: email.toLowerCase(),
      title: title || null,
      role,
      accessLevel,
      workingHours: workingHours || null,
      timeIncrementType: timeIncrementType || null,
      timeIncrement: timeIncrement || null,
      userITActivity: userITActivity !== undefined ? userITActivity : null,
      isActive: isActive !== undefined ? isActive : true,
    };
    
    // Only update password if provided
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    
    const teamMember = await prisma.teamMember.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        role: true,
        accessLevel: true,
        workingHours: true,
        timeIncrementType: true,
        timeIncrement: true,
        userITActivity: true,
        lastLoginAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    console.log(`API: PUT /team-members/${id} - Successfully updated team member: ${name}`);
    res.json(teamMember);
  } catch (error) {
    console.error('Error updating team member:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// Delete team member (admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`API: DELETE /team-members/${id} - Deleting team member`);
  
  try {
    // Check if team member exists
    const existingTeamMember = await prisma.teamMember.findUnique({
      where: { id },
      include: {
        timesheets: true,
        itActivities: true,
      },
    });
    
    if (!existingTeamMember) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    // Check if team member has associated data
    if (existingTeamMember.timesheets.length > 0 || existingTeamMember.itActivities.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete team member with associated timesheets or activities. Please delete them first.' 
      });
    }
    
    await prisma.teamMember.delete({
      where: { id },
    });

    console.log(`API: DELETE /team-members/${id} - Successfully deleted team member: ${existingTeamMember.name}`);
    res.json({ message: 'Team member deleted successfully' });
  } catch (error) {
    console.error('Error deleting team member:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

export default router;
