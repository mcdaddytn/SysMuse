import { 
  PrismaClient, 
  MarkerSection, 
  MarkerSectionType, 
  TrialEvent,
  Trial,
  MarkerSource,
  Prisma
} from '@prisma/client';
import { Logger } from '../utils/logger';
import { LongStatementsAccumulator } from './LongStatementsAccumulator';
import { TranscriptRenderer } from '../services/TranscriptRenderer';

interface HierarchyStatistics {
  totalSections: number;
  completedSections: number;
  zeroLengthSections: number;
  averageConfidence: number;
  coverage: {
    eventsTotal: number;
    eventsCovered: number;
    percentage: number;
  };
}

export class StandardTrialHierarchyBuilder {
  private logger = new Logger('StandardTrialHierarchyBuilder');
  private longStatementsAccumulator: LongStatementsAccumulator;
  private trialStyleConfig: any = null;

  constructor(
    private prisma: PrismaClient
  ) {
    this.longStatementsAccumulator = new LongStatementsAccumulator(prisma);
  }

  /**
   * Build complete Standard Trial Sequence hierarchy
   */
  async buildStandardHierarchy(trialId: number): Promise<void> {
    this.logger.info(`Building Standard Trial Hierarchy for trial ${trialId}`);
    
    try {
      // Load trial style config
      await this.loadTrialStyleConfig(trialId);
      // First, ensure we have a TRIAL root section
      const trialSection = await this.createTrialRootSection(trialId);
      
      // Step 1: Build witness testimony hierarchy (bottom-up)
      const testimonyPeriod = await this.buildWitnessTestimonyHierarchy(trialId, trialSection.id);
      
      // Step 2: Find opening and closing statements
      const openingPeriod = await this.findOpeningStatements(trialId, trialSection.id, testimonyPeriod);
      const closingPeriod = await this.findClosingStatements(trialId, trialSection.id, testimonyPeriod);
      
      // Step 3: Find jury-related sections
      const jurySelection = await this.findJurySelection(trialId, trialSection.id, openingPeriod);
      const caseIntro = await this.findCaseIntro(trialId, trialSection.id, jurySelection || openingPeriod);
      
      // Step 4: Find verdict and conclusion
      const juryVerdict = await this.findJuryVerdict(trialId, trialSection.id, closingPeriod);
      const juryDeliberation = await this.findJuryDeliberation(trialId, trialSection.id, closingPeriod, juryVerdict);
      const caseWrapup = await this.findCaseWrapup(trialId, trialSection.id, juryVerdict);
      
      // Step 5: Create Session hierarchy
      await this.createSessionHierarchy(trialId, trialSection.id);
      
      // Step 6: Generate auto-summaries for all sections
      await this.generateAutoSummaries(trialId);
      
      // Step 7: Calculate and log statistics
      const stats = await this.calculateHierarchyStatistics(trialId);
      this.logger.info(`Hierarchy statistics for trial ${trialId}: ${JSON.stringify(stats, null, 2)}`);
      
      this.logger.info(`Completed Standard Trial Hierarchy for trial ${trialId}`);
    } catch (error) {
      this.logger.error(`Error building hierarchy for trial ${trialId}:`, error);
      throw error;
    }
  }

  /**
   * Generate auto-summaries for all sections in the hierarchy
   */
  private async generateAutoSummaries(trialId: number): Promise<void> {
    this.logger.info(`Generating auto-summaries for trial ${trialId} sections`);
    
    // Pass trial style config to renderer
    const renderer = new TranscriptRenderer(this.prisma, this.trialStyleConfig);
    
    // Get all sections that need summaries
    const sections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        source: {
          in: [MarkerSource.PHASE3_HIERARCHY, MarkerSource.PHASE3_DISCOVERY]
        },
        // Only sections with actual event ranges
        startEventId: { not: null },
        endEventId: { not: null }
      }
    });
    
    let summaryCount = 0;
    for (const section of sections) {
      try {
        // Check config to see if we should save to file
        const saveToFile = this.trialStyleConfig?.saveMarkerSectionsToFile || false;
        const rendered = await renderer.renderAndSaveSummary(section.id, saveToFile);
        if (rendered && rendered.summary) {
          summaryCount++;
        }
      } catch (error) {
        this.logger.warn(`Failed to generate summary for section ${section.id}: ${error}`);
      }
    }
    
    this.logger.info(`Generated ${summaryCount} auto-summaries for trial ${trialId}`);
  }

  /**
   * Create or update the TRIAL root section
   */
  private async createTrialRootSection(trialId: number): Promise<MarkerSection> {
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId }
    });

    if (!trial) {
      throw new Error(`Trial ${trialId} not found`);
    }

    // Get first and last events
    const firstEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'asc' }
    });

    const lastEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'desc' }
    });

    if (!firstEvent || !lastEvent) {
      throw new Error(`No events found for trial ${trialId}`);
    }

    // Create or update TRIAL section
    const existingSection = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.TRIAL,
        source: MarkerSource.PHASE3_HIERARCHY
      }
    });

    if (existingSection) {
      return existingSection;
    }

    return await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.TRIAL,
        name: `${trial.shortName} - Complete Trial`,
        description: `Complete trial proceedings for ${trial.caseNumber}`,
        startEventId: firstEvent.id,
        endEventId: lastEvent.id,
        startTime: firstEvent.startTime,
        endTime: lastEvent.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 1.0,
        metadata: {
          caseNumber: trial.caseNumber,
          trialName: trial.name,
          shortName: trial.shortName
        }
      }
    });
  }

  /**
   * Build witness testimony hierarchy from existing witness markers
   */
  private async buildWitnessTestimonyHierarchy(
    trialId: number, 
    trialSectionId: number
  ): Promise<MarkerSection | null> {
    this.logger.info(`Building witness testimony hierarchy for trial ${trialId}`);

    // Find existing witness examination sections (using generic WITNESS_EXAMINATION)
    const examinationSections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: {
          in: [
            MarkerSectionType.WITNESS_EXAMINATION,
            MarkerSectionType.DIRECT_EXAMINATION,
            MarkerSectionType.CROSS_EXAMINATION,
            MarkerSectionType.REDIRECT_EXAMINATION,
            MarkerSectionType.RECROSS_EXAMINATION
          ]
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    if (examinationSections.length === 0) {
      this.logger.info('No witness examinations found');
      return await this.createZeroLengthSection({
        trialId,
        sectionType: MarkerSectionType.WITNESS_TESTIMONY_PERIOD,
        parentSectionId: trialSectionId,
        name: 'Witness Testimony Period',
        description: 'No witness testimony in this trial',
        reason: 'No witness examinations found'
      });
    }
    
    this.logger.info(`Found ${examinationSections.length} witness examination sections`);

    // Group examinations by witness (based on temporal proximity)
    const witnessGroups = await this.groupExaminationsByWitness(examinationSections);
    
    // Create individual WITNESS_TESTIMONY sections
    const witnessTestimonySections: MarkerSection[] = [];
    for (const group of witnessGroups) {
      const witnessSection = await this.createWitnessTestimonySection(group, trialId);
      witnessTestimonySections.push(witnessSection);
    }

    // Determine plaintiff vs defense witnesses
    const { plaintiffWitnesses, defenseWitnesses } = await this.categorizeWitnesses(
      witnessTestimonySections
    );

    // Create WITNESS_TESTIMONY_PLAINTIFF section
    let plaintiffSection: MarkerSection | null = null;
    if (plaintiffWitnesses.length > 0) {
      plaintiffSection = await this.createWitnessGroupSection(
        plaintiffWitnesses,
        trialId,
        MarkerSectionType.WITNESS_TESTIMONY_PLAINTIFF,
        'Plaintiff Witnesses',
        'All witness testimony presented by plaintiff'
      );
    }

    // Create WITNESS_TESTIMONY_DEFENSE section  
    let defenseSection: MarkerSection | null = null;
    if (defenseWitnesses.length > 0) {
      defenseSection = await this.createWitnessGroupSection(
        defenseWitnesses,
        trialId,
        MarkerSectionType.WITNESS_TESTIMONY_DEFENSE,
        'Defense Witnesses',
        'All witness testimony presented by defense'
      );
    }

    // Create WITNESS_TESTIMONY_PERIOD encompassing all testimony
    const allWitnessSections = [...(plaintiffSection ? [plaintiffSection] : []), 
                                ...(defenseSection ? [defenseSection] : [])];
    
    if (allWitnessSections.length === 0) {
      return null;
    }

    const firstSection = allWitnessSections[0];
    const lastSection = allWitnessSections[allWitnessSections.length - 1];

    const testimonyPeriod = await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY_PERIOD,
        parentSectionId: trialSectionId,
        name: 'Witness Testimony Period',
        description: 'All witness testimony in the trial',
        startEventId: firstSection.startEventId,
        endEventId: lastSection.endEventId,
        startTime: firstSection.startTime,
        endTime: lastSection.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 0.9,
        metadata: {
          totalWitnesses: witnessTestimonySections.length,
          plaintiffWitnesses: plaintiffWitnesses.length,
          defenseWitnesses: defenseWitnesses.length
        }
      }
    });

    // Update parent references for plaintiff/defense sections
    if (plaintiffSection) {
      await this.prisma.markerSection.update({
        where: { id: plaintiffSection.id },
        data: { parentSectionId: testimonyPeriod.id }
      });
    }
    if (defenseSection) {
      await this.prisma.markerSection.update({
        where: { id: defenseSection.id },
        data: { parentSectionId: testimonyPeriod.id }
      });
    }

    // Fix parent relationships for existing witness sections created by WitnessMarkerDiscovery
    await this.fixWitnessHierarchyRelationships(trialId, testimonyPeriod.id, plaintiffSection, defenseSection);

    return testimonyPeriod;
  }

  /**
   * Fix parent relationships for witness sections created by WitnessMarkerDiscovery
   */
  private async fixWitnessHierarchyRelationships(
    trialId: number,
    testimonyPeriodId: number,
    plaintiffSection: MarkerSection | null,
    defenseSection: MarkerSection | null
  ): Promise<void> {
    this.logger.info('Fixing witness hierarchy relationships');

    // Fix COMPLETE_WITNESS_TESTIMONY to be child of WITNESS_TESTIMONY_PERIOD
    const completeTestimony = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.COMPLETE_WITNESS_TESTIMONY
      }
    });
    
    if (completeTestimony && completeTestimony.parentSectionId !== testimonyPeriodId) {
      await this.prisma.markerSection.update({
        where: { id: completeTestimony.id },
        data: { parentSectionId: testimonyPeriodId }
      });
      this.logger.debug('Updated COMPLETE_WITNESS_TESTIMONY parent');
    }

    // Get all WITNESS_TESTIMONY sections (individual witnesses)
    const witnessTestimonies = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        name: {
          startsWith: 'WitnessTestimony_WITNESS_'
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    // Assign each witness testimony to plaintiff or defense section
    for (const testimony of witnessTestimonies) {
      let parentId: number | null = null;
      
      if (plaintiffSection && testimony.startEventId && plaintiffSection.startEventId && plaintiffSection.endEventId) {
        if (testimony.startEventId >= plaintiffSection.startEventId && 
            testimony.startEventId <= plaintiffSection.endEventId) {
          parentId = plaintiffSection.id;
        }
      }
      
      if (!parentId && defenseSection && testimony.startEventId && defenseSection.startEventId && defenseSection.endEventId) {
        if (testimony.startEventId >= defenseSection.startEventId && 
            testimony.startEventId <= defenseSection.endEventId) {
          parentId = defenseSection.id;
        }
      }
      
      if (parentId && testimony.parentSectionId !== parentId) {
        await this.prisma.markerSection.update({
          where: { id: testimony.id },
          data: { parentSectionId: parentId }
        });
        this.logger.debug(`Updated parent of ${testimony.name} to ${parentId}`);
      }
    }

    // Fix WITNESS_EXAMINATION sections to be children of their witness testimony sections
    const examinations = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_EXAMINATION
      },
      orderBy: { startEventId: 'asc' }
    });

    // Group examinations by witness
    const witnessGroups = new Map<number, MarkerSection[]>();

    for (const exam of examinations) {
      // Extract witness info from metadata instead of parsing the name
      // The new format uses witness fingerprint in names (e.g., "WitExam_Direct_JOHN_DOE")
      const metadata = exam.metadata as any;
      let witnessId: number | undefined = metadata?.witnessId;
      if (!witnessId) {
        // Try to extract from the old format if present
        const examMatch = exam.name?.match(/WITNESS_(\d+)/);
        if (!examMatch) {
          this.logger.warn(`Could not extract witness ID from examination: ${exam.name}`);
          continue;
        }
        const witnessIdFromName = parseInt(examMatch[1]);
        witnessGroups.set(witnessIdFromName, [...(witnessGroups.get(witnessIdFromName) || []), exam]);
        continue;
      }
      
      // Group examinations by witness
      witnessGroups.set(witnessId, [...(witnessGroups.get(witnessId) || []), exam]);
      
      // Find the testimony section with matching witness ID
      const parentTestimony = witnessTestimonies.find(testimony => {
        // Check metadata first for witness ID
        const testimonyMetadata = testimony.metadata as any;
        const testimonyWitnessId = testimonyMetadata?.witnessId as number | undefined;
        if (testimonyWitnessId) {
          return testimonyWitnessId === witnessId;
        }
        // Fall back to parsing the name for old format
        const testimonyMatch = testimony.name?.match(/WITNESS_(\d+)/);
        return testimonyMatch && parseInt(testimonyMatch[1]) === witnessId;
      });
      
      if (parentTestimony && exam.parentSectionId !== parentTestimony.id) {
        await this.prisma.markerSection.update({
          where: { id: exam.id },
          data: { parentSectionId: parentTestimony.id }
        });
        this.logger.debug(`Updated parent of ${exam.name} to ${parentTestimony.name}`);
      } else if (!parentTestimony) {
        this.logger.warn(`Could not find parent testimony for ${exam.name} with witness ID ${witnessId}`);
      }
    }

    this.logger.info('Completed fixing witness hierarchy relationships');
  }

  /**
   * Find opening statements using LongStatementsAccumulator
   */
  private async findOpeningStatements(
    trialId: number,
    trialSectionId: number,
    testimonyPeriod: MarkerSection | null
  ): Promise<MarkerSection> {
    this.logger.info(`Finding opening statements for trial ${trialId}`);

    // Search for opening statements before witness testimony
    // But also consider they might be in a different session
    // Expand the search range since opening statements can be very long (15-16 pages)
    const searchEndEvent = testimonyPeriod?.startEventId || 1500; // Much wider search range
    
    // Also set a reasonable search start (after jury selection typically)
    // For trial 1, we know afternoon session starts at 797
    const searchStartEvent = 797; // TODO: Make this dynamic based on session boundaries
    
    // Find plaintiff opening statement (reduced thresholds)
    const plaintiffOpening = await this.longStatementsAccumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      searchEndEvent,
      minWords: 50,  // Lower threshold for testing
      maxInterruptionRatio: 0.4  // Allow up to 40% interruption (judge, etc.)
    });

    // Find defense opening statement
    const defenseOpening = await this.longStatementsAccumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY', 
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      searchEndEvent,
      minWords: 100,  // Reduced from 500
      maxInterruptionRatio: 0.3  // Increased from 0.15
    });

    const openingStatements: MarkerSection[] = [];

    // Create plaintiff opening section
    if (plaintiffOpening && plaintiffOpening.confidence > 0.6) {
      const section = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.OPENING_STATEMENT_PLAINTIFF,
          name: 'Plaintiff Opening Statement',
          description: 'Opening statement by plaintiff counsel',
          startEventId: plaintiffOpening.startEvent.id,
          endEventId: plaintiffOpening.endEvent.id,
          startTime: plaintiffOpening.startEvent.startTime,
          endTime: plaintiffOpening.endEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: plaintiffOpening.confidence,
          metadata: {
            totalWords: plaintiffOpening.totalWords,
            speakerWords: plaintiffOpening.speakerWords,
            speakerRatio: plaintiffOpening.speakerRatio
          }
        }
      });
      openingStatements.push(section);
    }

    // Create defense opening section
    if (defenseOpening && defenseOpening.confidence > 0.6) {
      const section = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.OPENING_STATEMENT_DEFENSE,
          name: 'Defense Opening Statement',
          description: 'Opening statement by defense counsel',
          startEventId: defenseOpening.startEvent.id,
          endEventId: defenseOpening.endEvent.id,
          startTime: defenseOpening.startEvent.startTime,
          endTime: defenseOpening.endEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: defenseOpening.confidence,
          metadata: {
            totalWords: defenseOpening.totalWords,
            speakerWords: defenseOpening.speakerWords,
            speakerRatio: defenseOpening.speakerRatio
          }
        }
      });
      openingStatements.push(section);
    }

    // Create OPENING_STATEMENTS_PERIOD
    if (openingStatements.length > 0) {
      const firstOpening = openingStatements[0];
      const lastOpening = openingStatements[openingStatements.length - 1];

      const openingPeriod = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.OPENING_STATEMENTS_PERIOD,
          parentSectionId: trialSectionId,
          name: 'Opening Statements',
          description: 'Opening statements from all parties',
          startEventId: firstOpening.startEventId,
          endEventId: lastOpening.endEventId,
          startTime: firstOpening.startTime,
          endTime: lastOpening.endTime,
          source: MarkerSource.PHASE3_HIERARCHY,
          confidence: 0.8,
          metadata: {
            hasPlaintiffOpening: !!plaintiffOpening,
            hasDefenseOpening: !!defenseOpening
          }
        }
      });

      // Update parent references
      for (const opening of openingStatements) {
        await this.prisma.markerSection.update({
          where: { id: opening.id },
          data: { parentSectionId: openingPeriod.id }
        });
      }

      return openingPeriod;
    }

    // Create zero-length section if no openings found
    return await this.createZeroLengthSection({
      trialId,
      sectionType: MarkerSectionType.OPENING_STATEMENTS_PERIOD,
      parentSectionId: trialSectionId,
      name: 'Opening Statements',
      description: 'No opening statements found',
      reason: 'Could not identify opening statements with sufficient confidence'
    });
  }

  /**
   * Find closing statements using LongStatementsAccumulator
   */
  private async findClosingStatements(
    trialId: number,
    trialSectionId: number,
    testimonyPeriod: MarkerSection | null
  ): Promise<MarkerSection> {
    this.logger.info(`Finding closing statements for trial ${trialId}`);

    const searchStartEvent = testimonyPeriod?.endEventId || undefined;
    
    // Find plaintiff closing statement (reduced thresholds)
    const plaintiffClosing = await this.longStatementsAccumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      minWords: 100,  // Reduced from 500
      maxInterruptionRatio: 0.3  // Increased from 0.15
    });

    // Find defense closing statement
    const defenseClosing = await this.longStatementsAccumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      minWords: 100,  // Reduced from 500
      maxInterruptionRatio: 0.3  // Increased from 0.15
    });

    const closingStatements: MarkerSection[] = [];

    // Create plaintiff closing section
    if (plaintiffClosing && plaintiffClosing.confidence > 0.6) {
      const section = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CLOSING_STATEMENT_PLAINTIFF,
          name: 'Plaintiff Closing Statement',
          description: 'Closing statement by plaintiff counsel',
          startEventId: plaintiffClosing.startEvent.id,
          endEventId: plaintiffClosing.endEvent.id,
          startTime: plaintiffClosing.startEvent.startTime,
          endTime: plaintiffClosing.endEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: plaintiffClosing.confidence,
          metadata: {
            totalWords: plaintiffClosing.totalWords,
            speakerWords: plaintiffClosing.speakerWords,
            speakerRatio: plaintiffClosing.speakerRatio
          }
        }
      });
      closingStatements.push(section);
    }

    // Create defense closing section
    if (defenseClosing && defenseClosing.confidence > 0.6) {
      const section = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CLOSING_STATEMENT_DEFENSE,
          name: 'Defense Closing Statement',
          description: 'Closing statement by defense counsel',
          startEventId: defenseClosing.startEvent.id,
          endEventId: defenseClosing.endEvent.id,
          startTime: defenseClosing.startEvent.startTime,
          endTime: defenseClosing.endEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: defenseClosing.confidence,
          metadata: {
            totalWords: defenseClosing.totalWords,
            speakerWords: defenseClosing.speakerWords,
            speakerRatio: defenseClosing.speakerRatio
          }
        }
      });
      closingStatements.push(section);
    }

    // Removed plaintiff rebuttal logic - not part of standard trial sequence

    // Create CLOSING_STATEMENTS_PERIOD
    if (closingStatements.length > 0) {
      const firstClosing = closingStatements[0];
      const lastClosing = closingStatements[closingStatements.length - 1];

      const closingPeriod = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CLOSING_STATEMENTS_PERIOD,
          parentSectionId: trialSectionId,
          name: 'Closing Statements',
          description: 'Closing statements from all parties',
          startEventId: firstClosing.startEventId,
          endEventId: lastClosing.endEventId,
          startTime: firstClosing.startTime,
          endTime: lastClosing.endTime,
          source: MarkerSource.PHASE3_HIERARCHY,
          confidence: 0.8,
          metadata: {
            hasPlaintiffClosing: closingStatements.some(s => s.markerSectionType === MarkerSectionType.CLOSING_STATEMENT_PLAINTIFF),
            hasDefenseClosing: closingStatements.some(s => s.markerSectionType === MarkerSectionType.CLOSING_STATEMENT_DEFENSE)
          }
        }
      });

      // Update parent references
      for (const closing of closingStatements) {
        await this.prisma.markerSection.update({
          where: { id: closing.id },
          data: { parentSectionId: closingPeriod.id }
        });
      }

      return closingPeriod;
    }

    // Create zero-length section if no closings found
    return await this.createZeroLengthSection({
      trialId,
      sectionType: MarkerSectionType.CLOSING_STATEMENTS_PERIOD,
      parentSectionId: trialSectionId,
      name: 'Closing Statements',
      description: 'No closing statements found',
      reason: 'Could not identify closing statements with sufficient confidence'
    });
  }

  /**
   * Find jury selection period
   */
  private async findJurySelection(
    trialId: number,
    trialSectionId: number,
    openingPeriod: MarkerSection
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding jury selection for trial ${trialId}`);

    // Look for juror speech before opening statements
    const jurorStatements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          trialId,
          id: {
            lt: openingPeriod.startEventId || 0
          }
        },
        speaker: {
          speakerType: 'JUROR'
        }
      },
      include: {
        event: true
      },
      orderBy: {
        event: {
          ordinal: 'asc'
        }
      }
    });

    if (jurorStatements.length > 0) {
      const firstJuror = jurorStatements[0];
      const lastJuror = jurorStatements[jurorStatements.length - 1];

      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.JURY_SELECTION,
          parentSectionId: trialSectionId,
          name: 'Jury Selection',
          description: 'Voir dire and jury selection process',
          startEventId: firstJuror.eventId,
          endEventId: lastJuror.eventId,
          startTime: firstJuror.event.startTime,
          endTime: lastJuror.event.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: 0.8,
          metadata: {
            jurorStatements: jurorStatements.length
          }
        }
      });
    }

    return null;
  }

  /**
   * Find case introduction section
   */
  private async findCaseIntro(
    trialId: number,
    trialSectionId: number,
    beforeSection: MarkerSection
  ): Promise<MarkerSection> {
    this.logger.info(`Finding case introduction for trial ${trialId}`);

    // Get first event of trial
    const firstEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'asc' }
    });

    if (!firstEvent || !beforeSection.startEventId) {
      return await this.createZeroLengthSection({
        trialId,
        sectionType: MarkerSectionType.CASE_INTRO,
        parentSectionId: trialSectionId,
        name: 'Case Introduction',
        description: 'No case introduction found',
        reason: 'Unable to determine case introduction boundaries'
      });
    }

    // Get event just before the "before section"
    const endEvent = await this.prisma.trialEvent.findFirst({
      where: {
        trialId,
        id: {
          lt: beforeSection.startEventId
        }
      },
      orderBy: {
        id: 'desc'
      }
    });

    if (firstEvent.id < (endEvent?.id || beforeSection.startEventId)) {
      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CASE_INTRO,
          parentSectionId: trialSectionId,
          name: 'Case Introduction',
          description: 'Pre-trial proceedings and case introduction',
          startEventId: firstEvent.id,
          endEventId: endEvent?.id || firstEvent.id,
          startTime: firstEvent.startTime,
          endTime: endEvent?.endTime || firstEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: 0.7
        }
      });
    }

    return await this.createZeroLengthSection({
      trialId,
      sectionType: MarkerSectionType.CASE_INTRO,
      parentSectionId: trialSectionId,
      name: 'Case Introduction',
      description: 'No case introduction',
      reason: 'Trial starts directly with next section'
    });
  }

  /**
   * Find jury verdict section
   */
  private async findJuryVerdict(
    trialId: number,
    trialSectionId: number,
    closingPeriod: MarkerSection
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding jury verdict for trial ${trialId}`);

    // Look for foreperson speech after closing statements
    const forepersonStatements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          trialId,
          id: {
            gt: closingPeriod.endEventId || 0
          }
        },
        speaker: {
          OR: [
            { speakerHandle: { contains: 'FOREPERSON' } },
            { speakerHandle: { contains: 'FOREMAN' } },
            { speakerHandle: { contains: 'FOREWOMAN' } }
          ]
        }
      },
      include: {
        event: true
      },
      orderBy: {
        event: {
          ordinal: 'asc'
        }
      }
    });

    if (forepersonStatements.length > 0) {
      const firstStatement = forepersonStatements[0];
      const lastStatement = forepersonStatements[forepersonStatements.length - 1];

      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.JURY_VERDICT,
          parentSectionId: trialSectionId,
          name: 'Jury Verdict',
          description: 'Jury verdict announcement',
          startEventId: firstStatement.eventId,
          endEventId: lastStatement.eventId,
          startTime: firstStatement.event.startTime,
          endTime: lastStatement.event.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: 0.9,
          metadata: {
            forepersonStatements: forepersonStatements.length
          }
        }
      });
    }

    return null;
  }

  /**
   * Find jury deliberation section
   */
  private async findJuryDeliberation(
    trialId: number,
    trialSectionId: number,
    closingPeriod: MarkerSection,
    verdictSection: MarkerSection | null
  ): Promise<MarkerSection | null> {
    if (!verdictSection || !closingPeriod.endEventId || !verdictSection.startEventId) {
      return null;
    }

    // Check if there are events between closing and verdict
    const eventsInBetween = await this.prisma.trialEvent.count({
      where: {
        trialId,
        id: {
          gt: closingPeriod.endEventId,
          lt: verdictSection.startEventId
        }
      }
    });

    if (eventsInBetween > 0) {
      // Get first event after closing
      const startEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            gt: closingPeriod.endEventId
          }
        },
        orderBy: { id: 'asc' }
      });

      // Get last event before verdict
      const endEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            lt: verdictSection.startEventId
          }
        },
        orderBy: { id: 'desc' }
      });

      if (startEvent && endEvent) {
        return await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.JURY_DELIBERATION,
            parentSectionId: trialSectionId,
            name: 'Jury Deliberation',
            description: 'Jury deliberation period',
            startEventId: startEvent.id,
            endEventId: endEvent.id,
            startTime: startEvent.startTime,
            endTime: endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: 0.6,
            metadata: {
              eventCount: eventsInBetween
            }
          }
        });
      }
    }

    return null;
  }

  /**
   * Find case wrapup section
   */
  private async findCaseWrapup(
    trialId: number,
    trialSectionId: number,
    verdictSection: MarkerSection | null
  ): Promise<MarkerSection | null> {
    if (!verdictSection || !verdictSection.endEventId) {
      return null;
    }

    // Get last event of trial
    const lastEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'desc' }
    });

    if (!lastEvent || lastEvent.id <= verdictSection.endEventId) {
      return null;
    }

    // Get first event after verdict
    const startEvent = await this.prisma.trialEvent.findFirst({
      where: {
        trialId,
        id: {
          gt: verdictSection.endEventId
        }
      },
      orderBy: { id: 'asc' }
    });

    if (startEvent) {
      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CASE_WRAPUP,
          parentSectionId: trialSectionId,
          name: 'Case Wrapup',
          description: 'Post-verdict proceedings and case conclusion',
          startEventId: startEvent.id,
          endEventId: lastEvent.id,
          startTime: startEvent.startTime,
          endTime: lastEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: 0.7,
          metadata: {
            eventCount: await this.prisma.trialEvent.count({
              where: {
                trialId,
                id: {
                  gte: startEvent.id,
                  lte: lastEvent.id
                }
              }
            })
          }
        }
      });
    }

    return null;
  }

  /**
   * Create session hierarchy
   */
  private async createSessionHierarchy(trialId: number, trialSectionId: number): Promise<void> {
    this.logger.info(`Creating session hierarchy for trial ${trialId}`);

    // Get all sessions for the trial
    const sessions = await this.prisma.session.findMany({
      where: { trialId },
      orderBy: { sessionDate: 'asc' }
    });

    for (const session of sessions) {
      // Get events for this session
      const sessionEvents = await this.prisma.trialEvent.findMany({
        where: {
          trialId,
          sessionId: session.id
        },
        orderBy: { ordinal: 'asc' }
      });

      if (sessionEvents.length > 0) {
        const firstEvent = sessionEvents[0];
        const lastEvent = sessionEvents[sessionEvents.length - 1];

        await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.SESSION,
            parentSectionId: trialSectionId,
            name: `Session ${(session.metadata as any)?.sessionNumber || session.id}`,
            description: `${session.sessionType} session on ${session.sessionDate}`,
            startEventId: firstEvent.id,
            endEventId: lastEvent.id,
            startTime: firstEvent.startTime,
            endTime: lastEvent.endTime,
            source: MarkerSource.PHASE3_HIERARCHY,
            confidence: 1.0,
            metadata: {
              sessionId: session.id,
              sessionNumber: (session.metadata as any)?.sessionNumber || session.id,
              sessionDate: session.sessionDate,
              sessionType: session.sessionType,
              eventCount: sessionEvents.length
            }
          }
        });
      }
    }
  }

  /**
   * Helper method to group examinations by witness
   */
  private async groupExaminationsByWitness(
    examinations: MarkerSection[]
  ): Promise<MarkerSection[][]> {
    const groups: MarkerSection[][] = [];
    let currentGroup: MarkerSection[] = [];
    
    for (const exam of examinations) {
      if (currentGroup.length === 0) {
        currentGroup.push(exam);
      } else {
        // Check if this examination is for the same witness
        // (simplified logic - in reality would check metadata or witness info)
        const lastExam = currentGroup[currentGroup.length - 1];
        if (lastExam.endEventId && exam.startEventId && 
            Math.abs(exam.startEventId - lastExam.endEventId) < 100) {
          currentGroup.push(exam);
        } else {
          groups.push(currentGroup);
          currentGroup = [exam];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * Create a witness testimony section encompassing all examinations
   */
  private async createWitnessTestimonySection(
    examinations: MarkerSection[],
    trialId: number
  ): Promise<MarkerSection> {
    const firstExam = examinations[0];
    const lastExam = examinations[examinations.length - 1];
    
    return await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        name: 'Witness Testimony',
        description: 'Complete testimony of witness',
        startEventId: firstExam.startEventId,
        endEventId: lastExam.endEventId,
        startTime: firstExam.startTime,
        endTime: lastExam.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 0.85,
        metadata: {
          examinationCount: examinations.length,
          examinationTypes: examinations.map(e => e.markerSectionType)
        }
      }
    });
  }

  /**
   * Categorize witnesses as plaintiff or defense
   */
  private async categorizeWitnesses(
    witnessSections: MarkerSection[]
  ): Promise<{ plaintiffWitnesses: MarkerSection[], defenseWitnesses: MarkerSection[] }> {
    // Simple heuristic: first half are plaintiff, second half are defense
    // In a real implementation, would check who called the witness
    const midpoint = Math.floor(witnessSections.length / 2);
    
    return {
      plaintiffWitnesses: witnessSections.slice(0, midpoint),
      defenseWitnesses: witnessSections.slice(midpoint)
    };
  }

  /**
   * Create witness group section (plaintiff or defense)
   */
  private async createWitnessGroupSection(
    witnesses: MarkerSection[],
    trialId: number,
    sectionType: MarkerSectionType,
    name: string,
    description: string
  ): Promise<MarkerSection> {
    const firstWitness = witnesses[0];
    const lastWitness = witnesses[witnesses.length - 1];
    
    const section = await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: sectionType,
        name,
        description,
        startEventId: firstWitness.startEventId,
        endEventId: lastWitness.endEventId,
        startTime: firstWitness.startTime,
        endTime: lastWitness.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 0.8,
        metadata: {
          witnessCount: witnesses.length
        }
      }
    });

    // Update parent references for witness sections
    for (const witness of witnesses) {
      await this.prisma.markerSection.update({
        where: { id: witness.id },
        data: { parentSectionId: section.id }
      });
    }

    return section;
  }

  /**
   * Create a zero-length section for missing components
   */
  private async createZeroLengthSection(params: {
    trialId: number;
    sectionType: MarkerSectionType;
    parentSectionId: number;
    name: string;
    description: string;
    reason: string;
  }): Promise<MarkerSection> {
    // Find an appropriate insertion point (middle of trial)
    const midEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId: params.trialId },
      skip: await this.prisma.trialEvent.count({ where: { trialId: params.trialId } }) / 2,
      orderBy: { ordinal: 'asc' }
    });

    return await this.prisma.markerSection.create({
      data: {
        trialId: params.trialId,
        markerSectionType: params.sectionType,
        parentSectionId: params.parentSectionId,
        name: params.name,
        description: params.description,
        startEventId: midEvent?.id,
        endEventId: midEvent?.id,
        startTime: midEvent?.startTime,
        endTime: midEvent?.startTime, // Same as start for zero-length
        source: MarkerSource.PHASE3_ZEROLENGTH,
        confidence: 0.0,
        metadata: {
          zeroLength: true,
          reason: params.reason
        }
      }
    });
  }

  /**
   * Calculate hierarchy statistics
   */
  private async calculateHierarchyStatistics(trialId: number): Promise<HierarchyStatistics> {
    const sections = await this.prisma.markerSection.findMany({
      where: { trialId }
    });

    const totalEvents = await this.prisma.trialEvent.count({
      where: { trialId }
    });

    // Count events covered by sections
    const coveredEventIds = new Set<number>();
    for (const section of sections) {
      if (section.startEventId && section.endEventId) {
        const events = await this.prisma.trialEvent.findMany({
          where: {
            trialId,
            id: {
              gte: section.startEventId,
              lte: section.endEventId
            }
          },
          select: { id: true }
        });
        events.forEach(e => coveredEventIds.add(e.id));
      }
    }

    const zeroLengthSections = sections.filter(s => 
      s.metadata && typeof s.metadata === 'object' && 'zeroLength' in s.metadata
    );

    const confidences = sections.map(s => s.confidence || 0).filter(c => c > 0);
    const averageConfidence = confidences.length > 0 
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length 
      : 0;

    return {
      totalSections: sections.length,
      completedSections: sections.filter(s => s.confidence && s.confidence > 0).length,
      zeroLengthSections: zeroLengthSections.length,
      averageConfidence,
      coverage: {
        eventsTotal: totalEvents,
        eventsCovered: coveredEventIds.size,
        percentage: totalEvents > 0 ? (coveredEventIds.size / totalEvents) * 100 : 0
      }
    };
  }
  
  /**
   * Load trial style configuration from file
   */
  private async loadTrialStyleConfig(trialId: number): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Get the trial from the database
      const trial = await this.prisma.trial.findUnique({
        where: { id: trialId }
      });
      
      // Try to find trial-specific trialstyle.json
      let trialStylePath: string | null = null;
      
      if (trial && trial.shortName) {
        // Look for trial-specific config in output directory
        const trialOutputDir = path.join('./output/multi-trial', trial.shortName);
        const trialSpecificPath = path.join(trialOutputDir, 'trialstyle.json');
        
        if (fs.existsSync(trialSpecificPath)) {
          trialStylePath = trialSpecificPath;
          this.logger.info(`Loading trial-specific style config from: ${trialStylePath}`);
        }
      }
      
      // Fall back to default trial style config
      if (!trialStylePath) {
        trialStylePath = './config/trialstyle.json';
        this.logger.info(`Loading default trial style config from: ${trialStylePath}`);
      }
      
      if (fs.existsSync(trialStylePath)) {
        const configContent = fs.readFileSync(trialStylePath, 'utf-8');
        this.trialStyleConfig = JSON.parse(configContent);
        this.logger.debug(`Loaded trial style config with markerSummaryMode: ${this.trialStyleConfig.markerSummaryMode}`);
      } else {
        this.logger.warn(`Trial style config not found at: ${trialStylePath}`);
        // Use defaults
        this.trialStyleConfig = {
          markerSummaryMode: 'SUMMARYABRIDGED2',
          markerAppendMode: 'space',
          markerCleanMode: 'REMOVEEXTRASPACE',
          saveMarkerSectionsToFile: false
        };
      }
    } catch (error) {
      this.logger.error('Error loading trial style config:', error);
      // Use defaults on error
      this.trialStyleConfig = {
        markerSummaryMode: 'SUMMARYABRIDGED2',
        markerAppendMode: 'space',
        markerCleanMode: 'REMOVEEXTRASPACE',
        saveMarkerSectionsToFile: false
      };
    }
  }
}