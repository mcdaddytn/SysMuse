// src/server.ts

import express, { Application } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import timesheetRoutes from './routes/timesheet.routes';
import matterRoutes from './routes/matter.routes';
import teamMemberRoutes from './routes/teamMember.routes';
import taskRoutes from './routes/task.routes';

const app: Application = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/matters', matterRoutes);
app.use('/api/team-members', teamMemberRoutes);
app.use('/api/tasks', taskRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

