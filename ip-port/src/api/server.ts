/**
 * Patent Portfolio Workstation - API Server
 *
 * Express server providing REST API for the frontend
 */

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import * as dotenv from 'dotenv';

import patentsRouter from './routes/patents.routes.js';
import scoresRouter from './routes/scores.routes.js';
import authRouter from './routes/auth.routes.js';
import focusAreasRouter from './routes/focus-areas.routes.js';
import promptTemplatesRouter from './routes/prompt-templates.routes.js';
import workflowsRouter from './routes/workflows.routes.js';
import patentFamiliesRouter from './routes/patent-families.routes.js';
import sectorsRouter from './routes/sectors.routes.js';
import batchJobsRouter from './routes/batch-jobs.routes.js';
import tournamentsRouter from './routes/tournaments.routes.js';
import cpcRouter from './routes/cpc.routes.js';
import scoringTemplatesRouter from './routes/scoring-templates.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'patent-workstation-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 4 * 60 * 60 * 1000 // 4 hours
  }
}));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/patents', patentsRouter);
app.use('/api/scores', scoresRouter);
app.use('/api/focus-areas', focusAreasRouter);
app.use('/api/prompt-templates', promptTemplatesRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/patent-families', patentFamiliesRouter);
app.use('/api/sectors', sectorsRouter);
app.use('/api/batch-jobs', batchJobsRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/cpc', cpcRouter);
app.use('/api/scoring-templates', scoringTemplatesRouter);

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  Patent Portfolio Workstation - API Server                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Running on: http://localhost:${PORT}                           ║
║  Health:     http://localhost:${PORT}/api/health                ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
