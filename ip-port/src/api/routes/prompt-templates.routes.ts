/**
 * Prompt Templates API Routes (Standalone Library)
 *
 * CRUD for prompt templates independent of focus areas.
 * Templates in the library can be referenced contextually
 * from focus areas, patent detail, etc.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getFieldsForObjectType } from '../services/prompt-template-service.js';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/prompt-templates
 * List all templates, optionally filtered by objectType or focusAreaId
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { objectType, focusAreaId } = req.query;

    const where: Record<string, unknown> = {};
    if (objectType) where.objectType = objectType;
    if (focusAreaId === 'none') {
      where.focusAreaId = null;
    } else if (focusAreaId) {
      where.focusAreaId = focusAreaId;
    }

    const templates = await prisma.promptTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        focusArea: { select: { id: true, name: true } }
      }
    });

    res.json(templates);
  } catch (error) {
    console.error('Error fetching prompt templates:', error);
    res.status(500).json({ error: 'Failed to fetch prompt templates' });
  }
});

/**
 * GET /api/prompt-templates/meta/fields
 * Get available placeholder fields for an object type
 */
router.get('/meta/fields', async (req: Request, res: Response) => {
  try {
    const objectType = (req.query.objectType as string) || 'patent';
    const delimiterStart = (req.query.delimiterStart as string) || undefined;
    const delimiterEnd = (req.query.delimiterEnd as string) || undefined;
    const fields = getFieldsForObjectType(objectType, delimiterStart, delimiterEnd);
    res.json(fields);
  } catch (error) {
    console.error('Error fetching fields:', error);
    res.status(500).json({ error: 'Failed to fetch fields' });
  }
});

/**
 * GET /api/prompt-templates/meta/answer-types
 * Get available answer types for structured questions
 */
router.get('/meta/answer-types', async (_req: Request, res: Response) => {
  res.json([
    { value: 'INTEGER', label: 'Integer', description: 'Whole number, optionally with min/max range' },
    { value: 'FLOAT', label: 'Float', description: 'Decimal number' },
    { value: 'BOOLEAN', label: 'Boolean', description: 'True or false' },
    { value: 'TEXT', label: 'Text', description: 'Free text response, optionally limited by sentence count' },
    { value: 'ENUM', label: 'Enum', description: 'One of a predefined set of options' },
    { value: 'TEXT_ARRAY', label: 'Text Array', description: 'List of text values' },
  ]);
});

/**
 * GET /api/prompt-templates/:id
 * Get a single template
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const template = await prisma.promptTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        focusArea: { select: { id: true, name: true } }
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching prompt template:', error);
    res.status(500).json({ error: 'Failed to fetch prompt template' });
  }
});

/**
 * POST /api/prompt-templates
 * Create a template (not bound to a focus area)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      templateType = 'FREE_FORM',
      objectType = 'patent',
      promptText,
      questions,
      executionMode = 'PER_PATENT',
      contextFields = [],
      llmModel = 'claude-sonnet-4-20250514',
      focusAreaId,
      delimiterStart,
      delimiterEnd
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const template = await prisma.promptTemplate.create({
      data: {
        name,
        description,
        templateType,
        objectType,
        promptText: promptText || null,
        questions: questions || null,
        executionMode,
        contextFields,
        llmModel,
        focusAreaId: focusAreaId || null,
        delimiterStart: delimiterStart || '<<',
        delimiterEnd: delimiterEnd || '>>',
        status: 'DRAFT'
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating prompt template:', error);
    res.status(500).json({ error: 'Failed to create prompt template' });
  }
});

/**
 * PUT /api/prompt-templates/:id
 * Update a template
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, templateType, objectType, promptText, questions, executionMode, contextFields, llmModel, focusAreaId, delimiterStart, delimiterEnd } = req.body;

    const template = await prisma.promptTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(templateType !== undefined && { templateType }),
        ...(objectType !== undefined && { objectType }),
        ...(promptText !== undefined && { promptText }),
        ...(questions !== undefined && { questions }),
        ...(executionMode !== undefined && { executionMode }),
        ...(contextFields !== undefined && { contextFields }),
        ...(llmModel !== undefined && { llmModel }),
        ...(focusAreaId !== undefined && { focusAreaId: focusAreaId || null }),
        ...(delimiterStart !== undefined && { delimiterStart }),
        ...(delimiterEnd !== undefined && { delimiterEnd }),
      }
    });

    res.json(template);
  } catch (error) {
    console.error('Error updating prompt template:', error);
    res.status(500).json({ error: 'Failed to update prompt template' });
  }
});

/**
 * DELETE /api/prompt-templates/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.promptTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt template:', error);
    res.status(500).json({ error: 'Failed to delete prompt template' });
  }
});

export default router;
