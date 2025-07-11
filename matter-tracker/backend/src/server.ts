// src/server.ts - Updated version with IT Activity routes

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import { PrismaClient } from '@prisma/client';
import timesheetRoutes from './routes/timesheet.routes';
import matterRoutes from './routes/matter.routes';
import teamMemberRoutes from './routes/teamMember.routes';
import taskRoutes from './routes/task.routes';
import itActivityRoutes from './routes/itActivity.routes';
import settingsRoutes from './routes/settings.routes';
import authRoutes from './routes/auth.routes';

dotenv.config();

const app: Application = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:9002',
  credentials: true
}));
app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 4 * 60 * 60 * 1000 // 4 hours
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/matters', matterRoutes);
app.use('/api/team-members', teamMemberRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/it-activities', itActivityRoutes);
app.use('/api/settings', settingsRoutes);

// Test route
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Test the API at http://localhost:${PORT}/api/health`);
  console.log('Available routes:');
  console.log('  - /api/timesheets');
  console.log('  - /api/matters');
  console.log('  - /api/team-members');
  console.log('  - /api/tasks');
  console.log('  - /api/it-activities');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
