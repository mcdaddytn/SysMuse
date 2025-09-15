// src/api/server.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
//import { TranscriptParser } from '../parsers/phase1/TranscriptParser';
//import { Phase2Processor } from '../parsers/phase2/Phase2Processor';
//import { Phase3Processor } from '../parsers/phase3/Phase3Processor';
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { Phase3Processor } from '../parsers/Phase3Processor';
import { SearchService } from '../services/SearchService';
import { TranscriptExportService } from '../services/TranscriptExportService';
import { CombinedSearchService } from '../services/CombinedSearchService';
import logger from '../utils/logger';
import reportsRouter from './routes/reports';
import hierarchyRouter from './routes/hierarchy';
const multer = require('multer');
import path from 'path';

const app: Express = express();
const prisma = new PrismaClient();
const searchService = new SearchService();
const exportService = new TranscriptExportService();

// Middleware
app.use(cors()); // Enable CORS for all origins in development
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from config and templates directories for frontend
app.use('/config', express.static(path.join(__dirname, '../../config')));
app.use('/templates', express.static(path.join(__dirname, '../../templates')));

// Mount report routes
app.use('/api/reports', reportsRouter);

// Mount hierarchy routes
app.use('/api/hierarchy', hierarchyRouter);

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Get all trials
app.get('/api/trials', async (req: Request, res: Response) => {
  try {
    const trials = await prisma.trial.findMany({
      include: {
        judge: true,
        _count: {
          select: {
            sessions: true,
            attorneys: true,
            witnesses: true
          }
        }
      }
    });
    res.json(trials);
  } catch (error) {
    logger.error('Error fetching trials:', error);
    res.status(500).json({ error: 'Failed to fetch trials' });
  }
});

// Get trial details
app.get('/api/trials/:id', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.id);
    
    const trial = await prisma.trial.findUnique({
      where: { id: trialId },
      include: {
        judge: true,
        courtReporter: true,
        sessions: {
          orderBy: [
            { sessionDate: 'asc' },
            { sessionType: 'asc' }
          ]
        },
        attorneys: {
          include: {
            attorney: true,
            lawFirm: true
          }
        },
        witnesses: true
        /*
        witnesses: true,
        markers: {
          orderBy: { startTime: 'asc' }
        }
        */
      }
    });
    
    if (!trial) {
      res.status(404).json({ error: 'Trial not found' });
      return;
    }
    
    res.json(trial);
  } catch (error) {
    logger.error('Error fetching trial:', error);
    res.status(500).json({ error: 'Failed to fetch trial' });
  }
});

// Upload and process transcripts
app.post('/api/trials/upload', 
  upload.array('files', 50),
  async (req: any, res: Response) => {
    try {
      const files = req.files as any[];
      
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }
      
      const config = {
        transcriptPath: path.dirname(files[0].path),
        format: req.body.format || 'txt',
        caseName: req.body.caseName,
        caseNumber: req.body.caseNumber,
        phases: {
          phase1: req.body.runPhase1 !== 'false',
          phase2: req.body.runPhase2 === 'true',
          phase3: req.body.runPhase3 === 'true'
        }
      };
      
      // Run Phase 1
      if (config.phases.phase1) {
        const parser = new TranscriptParser(config as any);
        await parser.parseDirectory();
      }
      
      // Get created trial
      const trial = await prisma.trial.findFirst({
        where: { caseNumber: config.caseNumber },
        orderBy: { createdAt: 'desc' }
      });
      
      if (!trial) {
        res.status(500).json({ error: 'Failed to create trial' });
        return;
      }
      
      // Run Phase 2
      if (config.phases.phase2) {
        const processor = new Phase2Processor(config as any);
        await processor.processTrial(trial.id);
      }
      
      // Run Phase 3
      if (config.phases.phase3) {
        const processor = new Phase3Processor(config as any);
        await processor.process();
      }
      
      res.json({
        message: 'Transcripts processed successfully',
        trialId: trial.id,
        filesProcessed: files.length
      });
      
    } catch (error) {
      logger.error('Error processing upload:', error);
      res.status(500).json({ error: 'Failed to process transcripts' });
    }
  }
);

// Search transcripts (legacy)
app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const searchQuery = req.body;
    const results = await searchService.search(searchQuery);
    
    res.json({
      query: searchQuery.query,
      total: results.length,
      results: results.slice(0, searchQuery.limit || 50)
    });
  } catch (error) {
    logger.error('Error during search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Advanced search with SQL and Elasticsearch
app.post('/api/search/advanced', async (req: Request, res: Response) => {
  try {
    const searchInput = req.body;
    const combinedSearchService = new CombinedSearchService();
    
    const results = await combinedSearchService.executeSearch(searchInput);
    
    res.json({
      success: true,
      totalStatements: results.totalStatements,
      matchedStatements: results.matchedStatements,
      elasticSearchSummary: results.elasticSearchSummary,
      results: searchInput.includeFullResults ? results.results : results.results.slice(0, searchInput.limit || 100)
    });
    
    await combinedSearchService.disconnect();
  } catch (error) {
    logger.error('Error during advanced search:', error);
    res.status(500).json({ error: 'Advanced search failed', details: String(error) });
  }
});

// Export transcript
app.post('/api/export', async (req: Request, res: Response) => {
  try {
    const exportConfig = {
      ...req.body,
      outputPath: path.join('exports', `trial-${req.body.trialId}-${Date.now()}.${req.body.format || 'txt'}`)
    };
    
    await exportService.exportTranscript(exportConfig);
    
    res.json({
      message: 'Export completed successfully',
      path: exportConfig.outputPath
    });
  } catch (error) {
    logger.error('Error during export:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Get session events
app.get('/api/sessions/:id/events', async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id);
    
    const events = await prisma.trialEvent.findMany({
      where: { sessionId },
      orderBy: { startTime: 'asc' },
      include: {
        courtDirective: true,
        statement: true,
        witnessCalled: true
      }
    });
    
    res.json(events);
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get markers for a trial
app.get('/api/trials/:id/markers', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.id);
    const { type, resolved } = req.query;
    
    const where: any = { trialId };
    
    if (type) {
      where.markerType = type as string;
    }
    
    if (resolved !== undefined) {
      where.isResolved = resolved === 'true';
    }
    
    const markers = await prisma.marker.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        event: true
      }
    });
    
    res.json(markers);
  } catch (error) {
    logger.error('Error fetching markers:', error);
    res.status(500).json({ error: 'Failed to fetch markers' });
  }
});

// Start server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`API Server: http://localhost:${PORT}`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
}); 