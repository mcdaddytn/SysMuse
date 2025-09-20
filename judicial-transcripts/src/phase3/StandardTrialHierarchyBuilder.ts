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
import { LongStatementsAccumulatorV3, LongStatementParamsV3 } from './LongStatementsAccumulatorV3';
import { ArgumentFinder } from './ArgumentFinder';
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
  private longStatementsAccumulatorV3: LongStatementsAccumulatorV3;
  private argumentFinder: ArgumentFinder;
  private trialStyleConfig: any = null;
  private useV3Accumulator: boolean = true; // Always use V3 with state tracking
  private useArgumentFinder: boolean = false; // Use V3 directly instead of ArgumentFinder

  constructor(
    private prisma: PrismaClient
  ) {
    this.longStatementsAccumulatorV3 = new LongStatementsAccumulatorV3(prisma);
    this.argumentFinder = new ArgumentFinder(prisma);
  }

  /**
   * Build complete Standard Trial Sequence hierarchy
   */
  async buildStandardHierarchy(trialId: number): Promise<void> {
    this.logger.info(`Building Standard Trial Hierarchy for trial ${trialId}`);

    try {
      // Clean up old hierarchy sections from previous runs
      await this.cleanupOldHierarchySections(trialId);

      // Load trial style config
      await this.loadTrialStyleConfig(trialId);
      // First, ensure we have a TRIAL root section
      const trialSection = await this.createTrialRootSection(trialId);
      
      // Phase 1: Build witness testimony hierarchy (establishes core periods)
      const testimonyPeriod = await this.buildWitnessTestimonyHierarchy(trialId, trialSection.id);

      // Phase 2: Find jury selection (refines pre-testimony period)
      const jurySelection = await this.findJurySelection(trialId, trialSection.id, testimonyPeriod);

      // Phase 3: Find case introduction (uses jury selection boundary if found)
      const caseIntro = await this.findCaseIntro(trialId, trialSection.id, jurySelection, testimonyPeriod);

      // Phase 4: Find opening statements (uses narrowed window after jury selection)
      const openingPeriod = await this.findOpeningStatements(trialId, trialSection.id, testimonyPeriod, jurySelection);

      // Phase 5: Find closing statements
      const closingPeriod = await this.findClosingStatements(trialId, trialSection.id, testimonyPeriod);

      // Phase 6: Find jury verdict first (search for FOREPERSON)
      const juryVerdict = await this.findJuryVerdict(trialId, trialSection.id, closingPeriod);

      // Phase 7: Determine jury deliberation and case wrapup based on verdict
      const juryDeliberation = await this.findJuryDeliberation(trialId, trialSection.id, closingPeriod, juryVerdict);
      const caseWrapup = await this.findCaseWrapup(trialId, trialSection.id, juryVerdict, closingPeriod);

      // Step 5: Adjust closing period based on jury events if found
      if (closingPeriod && (juryDeliberation || juryVerdict)) {
        await this.adjustClosingPeriodBounds(closingPeriod, juryDeliberation, juryVerdict);
      }

      // Step 6: Create Session hierarchy
      await this.createSessionHierarchy(trialId, trialSection.id);

      // Step 7: Clean up redundant sections
      await this.cleanupRedundantSections(trialId);

      // Step 8: Generate auto-summaries for all sections
      await this.generateAutoSummaries(trialId);

      // Step 9: Calculate and log statistics
      const stats = await this.calculateHierarchyStatistics(trialId);
      this.logger.info(`Hierarchy statistics for trial ${trialId}: ${JSON.stringify(stats, null, 2)}`);

      this.logger.info(`Completed Standard Trial Hierarchy for trial ${trialId}`);
    } catch (error) {
      this.logger.error(`Error building hierarchy for trial ${trialId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up old hierarchy sections from previous phase3 runs
   */
  private async cleanupOldHierarchySections(trialId: number): Promise<void> {
    this.logger.info(`Cleaning up old hierarchy sections for trial ${trialId}`);

    // Delete old hierarchy sections created by phase3
    // Keep the original witness testimony sections created by WitnessMarkerDiscovery
    const deletedCount = await this.prisma.markerSection.deleteMany({
      where: {
        trialId,
        source: MarkerSource.PHASE3_HIERARCHY,
        markerSectionType: {
          in: [
            MarkerSectionType.TRIAL,
            MarkerSectionType.WITNESS_TESTIMONY_PLAINTIFF,
            MarkerSectionType.WITNESS_TESTIMONY_DEFENSE,
            MarkerSectionType.WITNESS_TESTIMONY_PERIOD,
            MarkerSectionType.OPENING_STATEMENTS_PERIOD,
            MarkerSectionType.CLOSING_STATEMENTS_PERIOD,
            MarkerSectionType.JURY_SELECTION,
            MarkerSectionType.JURY_DELIBERATION,
            MarkerSectionType.JURY_VERDICT,
            MarkerSectionType.CASE_INTRO,
            MarkerSectionType.CASE_WRAPUP,
            MarkerSectionType.SESSION
          ]
        }
      }
    });

    if (deletedCount.count > 0) {
      this.logger.info(`Deleted ${deletedCount.count} old hierarchy sections`);
    }

    // Also delete duplicate WITNESS_TESTIMONY sections that don't have WitTest_ prefix
    // These are generic sections that shouldn't exist
    const deletedGeneric = await this.prisma.markerSection.deleteMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        NOT: {
          name: {
            startsWith: 'WitTest_'
          }
        }
      }
    });

    if (deletedGeneric.count > 0) {
      this.logger.info(`Deleted ${deletedGeneric.count} generic witness testimony sections`);
    }

    // Find and remove duplicate WitTest_ sections (keep the one with the lowest ID)
    const witTestSections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        name: {
          startsWith: 'WitTest_'
        }
      },
      orderBy: { id: 'asc' }
    });

    // Group by name to find duplicates
    const sectionsByName = new Map<string, typeof witTestSections>();
    for (const section of witTestSections) {
      if (!section.name) continue;
      if (!sectionsByName.has(section.name)) {
        sectionsByName.set(section.name, []);
      }
      sectionsByName.get(section.name)!.push(section);
    }

    // Delete duplicates (keep first one)
    let duplicatesDeleted = 0;
    for (const [name, sections] of sectionsByName) {
      if (sections.length > 1) {
        this.logger.warn(`Found ${sections.length} duplicate sections for ${name}, keeping first one (id: ${sections[0].id})`);
        const idsToDelete = sections.slice(1).map(s => s.id);

        // First, update any child sections to point to the keeper
        await this.prisma.markerSection.updateMany({
          where: {
            parentSectionId: {
              in: idsToDelete
            }
          },
          data: {
            parentSectionId: sections[0].id
          }
        });

        // Then delete the duplicates
        const deleted = await this.prisma.markerSection.deleteMany({
          where: {
            id: {
              in: idsToDelete
            }
          }
        });
        duplicatesDeleted += deleted.count;
      }
    }

    if (duplicatesDeleted > 0) {
      this.logger.info(`Deleted ${duplicatesDeleted} duplicate WitTest_ sections`);
    }
  }

  /**
   * Clean up redundant sections in the hierarchy
   */
  private async cleanupRedundantSections(trialId: number): Promise<void> {
    this.logger.info(`Cleaning up redundant sections for trial ${trialId}`);

    // 1. Remove "CompleteWitnessTestimony" if it's a child of "Witness Testimony Period" with no children
    const completeTestimony = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        name: 'CompleteWitnessTestimony'
      }
    });

    if (completeTestimony) {
      // Check if it has children
      const childCount = await this.prisma.markerSection.count({
        where: {
          parentSectionId: completeTestimony.id
        }
      });

      if (childCount === 0) {
        const parent = await this.prisma.markerSection.findFirst({
          where: {
            id: completeTestimony.parentSectionId || -1,
            name: 'Witness Testimony Period'
          }
        });

        if (parent) {
          // This is redundant - delete it
          await this.prisma.markerSection.delete({
            where: { id: completeTestimony.id }
          });
          this.logger.info(`Removed redundant CompleteWitnessTestimony section`);
        }
      }
    }

    // 2. Remove generic "Witness Testimony" sections that have no children when specific witness sections exist
    const genericWitnessTestimony = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        name: 'Witness Testimony',
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY
      }
    });

    for (const section of genericWitnessTestimony) {
      // Check if it has children
      const childCount = await this.prisma.markerSection.count({
        where: {
          parentSectionId: section.id
        }
      });

      if (childCount === 0) {
        // Check if there are specific witness testimony sections (e.g., WitTest_MARK_STEWART)
        const specificWitnessSection = await this.prisma.markerSection.findFirst({
          where: {
            trialId,
            name: {
              startsWith: 'WitTest_'
            },
            parentSectionId: section.parentSectionId
          }
        });

        if (specificWitnessSection) {
          // This generic section is redundant - delete it
          await this.prisma.markerSection.delete({
            where: { id: section.id }
          });
          this.logger.info(`Removed redundant generic Witness Testimony section`);
        }
      }
    }

    // 3. Remove any section that has the same name as its parent and no children
    const allSections = await this.prisma.markerSection.findMany({
      where: { trialId }
    });

    for (const section of allSections) {
      if (section.parentSectionId) {
        const parent = await this.prisma.markerSection.findUnique({
          where: { id: section.parentSectionId }
        });

        if (parent && section.name === parent.name) {
          // Check if this section has children
          const childCount = await this.prisma.markerSection.count({
            where: {
              parentSectionId: section.id
            }
          });

          if (childCount === 0) {
            await this.prisma.markerSection.delete({
              where: { id: section.id }
            });
            this.logger.info(`Removed duplicate section: ${section.name}`);
          }
        }
      }
    }

    this.logger.info(`Completed cleanup of redundant sections for trial ${trialId}`);
  }

  /**
   * Generate auto-summaries for all sections in the hierarchy
   */
  private async generateAutoSummaries(trialId: number): Promise<void> {
    this.logger.info(`Generating auto-summaries for trial ${trialId} sections`);

    // Pass trial style config to renderer
    const renderer = new TranscriptRenderer(this.prisma, this.trialStyleConfig);

    // Get all sections that need summaries, ordered chronologically
    const sections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        source: {
          in: [MarkerSource.PHASE3_HIERARCHY, MarkerSource.PHASE3_DISCOVERY]
        },
        // Only sections with actual event ranges
        startEventId: { not: null },
        endEventId: { not: null }
      },
      orderBy: [
        { parentSectionId: 'asc' },  // Group by parent first
        { startEventId: 'asc' }       // Then chronologically within each group
      ]
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

    // Step 1: Find existing WitTest_ sections created by WitnessMarkerDiscovery
    const witnessTestimonySections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        name: {
          startsWith: 'WitTest_'
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    if (witnessTestimonySections.length === 0) {
      this.logger.info('No witness testimony sections found');
      return await this.createZeroLengthSection({
        trialId,
        sectionType: MarkerSectionType.WITNESS_TESTIMONY_PERIOD,
        parentSectionId: trialSectionId,
        name: 'Witness Testimony Period',
        description: 'No witness testimony in this trial',
        reason: 'No witness testimony sections found'
      });
    }

    this.logger.info(`Found ${witnessTestimonySections.length} witness testimony sections`);

    // Step 2: Link examination sections to their parent WitTest_ sections
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

    this.logger.info(`Found ${examinationSections.length} examination sections to link`);

    // Link examinations to their witness testimony sections
    for (const exam of examinationSections) {
      // Extract witness name from examination name
      const nameMatch = exam.name?.match(/WitExam_(?:Direct|Cross|Redir|Recross)_(.+)/);
      if (nameMatch) {
        const witnessName = nameMatch[1];
        const witTestSection = witnessTestimonySections.find(w => w.name === `WitTest_${witnessName}`);

        if (witTestSection) {
          await this.prisma.markerSection.update({
            where: { id: exam.id },
            data: { parentSectionId: witTestSection.id }
          });
          this.logger.debug(`Linked ${exam.name} to ${witTestSection.name}`);
        } else {
          this.logger.warn(`Could not find WitTest section for examination: ${exam.name}`);
        }
      }
    }

    // Step 3: Determine plaintiff vs defense witnesses
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

    // Find the true end of witness testimony by looking for the last witness statement
    // This is critical for correct closing statement detection
    const actualEndEventId = await this.findActualEndOfWitnessTestimony(trialId, lastSection.endEventId);

    // Get the actual end event details
    const actualEndEvent = actualEndEventId ? await this.prisma.trialEvent.findUnique({
      where: { id: actualEndEventId }
    }) : null;

    const testimonyPeriod = await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY_PERIOD,
        parentSectionId: trialSectionId,
        name: 'Witness Testimony Period',
        description: 'All witness testimony in the trial',
        startEventId: firstSection.startEventId,
        endEventId: actualEndEventId || lastSection.endEventId,
        startTime: firstSection.startTime,
        endTime: actualEndEvent?.endTime || lastSection.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 0.9,
        metadata: {
          totalWitnesses: witnessTestimonySections.length,
          plaintiffWitnesses: plaintiffWitnesses.length,
          defenseWitnesses: defenseWitnesses.length,
          endCorrected: actualEndEventId !== lastSection.endEventId
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
          startsWith: 'WitTest_'  // New naming convention
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    // DO NOT reassign witness testimony parents based on event ranges!
    // The parents were already correctly assigned in createWitnessGroupSection based on witness caller.
    // The event range logic is flawed because plaintiff section encompasses ALL witnesses' event ranges.
    this.logger.info('Skipping parent reassignment - parents were already correctly set based on witness caller');

    // Just verify the parents are correct
    for (const testimony of witnessTestimonies) {
      const currentParentId = testimony.parentSectionId;
      if (currentParentId === plaintiffSection?.id) {
        this.logger.debug(`  ${testimony.name} is under Plaintiff Witnesses`);
      } else if (currentParentId === defenseSection?.id) {
        this.logger.debug(`  ${testimony.name} is under Defense Witnesses`);
      } else {
        this.logger.warn(`  ${testimony.name} has unexpected parent: ${currentParentId}`);
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

    for (const exam of examinations) {
      // Extract witness handle from the examination name
      // New format: "WitExam_Direct_BRENDON_MILLS" or "WitExam_Cross_JOHN_DOE"
      const examNameParts = exam.name?.split('_');
      if (!examNameParts || examNameParts.length < 3) {
        this.logger.warn(`Could not parse examination name: ${exam.name}`);
        continue;
      }

      // Extract the witness handle (everything after the examination type)
      const witnessHandle = examNameParts.slice(2).join('_');

      // Find the matching WITNESS_TESTIMONY section by name pattern
      // Format: "WitTest_BRENDON_MILLS"
      const parentTestimony = witnessTestimonies.find(testimony => {
        return testimony.name === `WitTest_${witnessHandle}`;
      });

      if (parentTestimony && exam.parentSectionId !== parentTestimony.id) {
        await this.prisma.markerSection.update({
          where: { id: exam.id },
          data: { parentSectionId: parentTestimony.id }
        });
        this.logger.debug(`Updated parent of ${exam.name} to ${parentTestimony.name}`);
      } else if (!parentTestimony) {
        // Try using metadata as fallback
        const metadata = exam.metadata as any;
        const witnessId = metadata?.witnessId;

        if (witnessId) {
          const parentByMetadata = witnessTestimonies.find(testimony => {
            const testimonyMetadata = testimony.metadata as any;
            return testimonyMetadata?.witnessId === witnessId;
          });

          if (parentByMetadata && exam.parentSectionId !== parentByMetadata.id) {
            await this.prisma.markerSection.update({
              where: { id: exam.id },
              data: { parentSectionId: parentByMetadata.id }
            });
            this.logger.debug(`Updated parent of ${exam.name} to ${parentByMetadata.name} (by metadata)`);
          } else {
            this.logger.warn(`Could not find parent testimony for ${exam.name}`);
          }
        } else {
          this.logger.warn(`Could not find parent testimony for ${exam.name}`);
        }
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
    testimonyPeriod: MarkerSection | null,
    jurySelection: MarkerSection | null
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding opening statements for trial ${trialId}`);

    // Search for opening statements BEFORE witness testimony
    // The search range depends on whether jury selection was found
    let searchEndEvent: number | undefined;
    let searchStartEvent: number | undefined;

    if (testimonyPeriod?.startEventId) {
      // We have witness testimony, so search up to witness testimony start
      searchEndEvent = testimonyPeriod.startEventId - 1;

      // Starting point depends on jury selection
      if (jurySelection && jurySelection.endEventId) {
        // Search AFTER jury selection
        searchStartEvent = jurySelection.endEventId + 1;
        this.logger.info('Narrowed opening statements search to after jury selection');
      } else {
        // No jury selection, search from trial start
        const firstTrialEvent = await this.prisma.trialEvent.findFirst({
          where: { trialId },
          orderBy: { id: 'asc' }
        });

        if (firstTrialEvent) {
          searchStartEvent = firstTrialEvent.id;
        }
      }
    } else {
      // No witness testimony found, search the first portion of the trial
      // This is a fallback scenario
      const firstTrialEvent = await this.prisma.trialEvent.findFirst({
        where: { trialId },
        orderBy: { id: 'asc' }
      });

      const trialEventCount = await this.prisma.trialEvent.count({
        where: { trialId }
      });

      if (firstTrialEvent) {
        // Start after jury selection if found
        searchStartEvent = jurySelection?.endEventId ? jurySelection.endEventId + 1 : firstTrialEvent.id;
        // Search first third of trial if no witness testimony found
        searchEndEvent = firstTrialEvent.id + Math.floor(trialEventCount / 3);
      }
    }

    this.logger.info(`Searching for opening statements between events ${searchStartEvent} and ${searchEndEvent}`);

    // Get config parameters with defaults for opening statements
    const longStatementConfig = this.trialStyleConfig?.longStatements || {};
    const ratioMode = longStatementConfig.ratioMode || 'WORD_RACE3';  // Use WORD_RACE3 as default
    const ratioThreshold = 0.4; // Lower threshold for opening statements

    this.logger.info(`[HIERARCHY CONFIG - OPENING] Using ratio mode: ${ratioMode}, threshold: ${ratioThreshold}`);
    this.logger.info(`[HIERARCHY CONFIG - OPENING] longStatementConfig: ${JSON.stringify(longStatementConfig)}`);
    this.logger.info(`[HIERARCHY CONFIG - OPENING] useV3Accumulator: ${this.useV3Accumulator}, useArgumentFinder: ${this.useArgumentFinder}`);

    // Get trial info for V3
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      select: { shortName: true }
    });

    // Use V3 Accumulator if enabled (with state tracking)
    if (this.useV3Accumulator) {
      this.logger.warn('[HIERARCHY STRATEGY] Using V3 Accumulator DIRECTLY with state tracking for opening statements');

      // Clear any accumulated evaluations from previous searches
      this.longStatementsAccumulatorV3.clearAccumulatedEvaluations();

      // Find defense first, then narrow window for plaintiff
      const defenseParams: LongStatementParamsV3 = {
        trialId,
        trialName: trial?.shortName || `trial_${trialId}`,
        speakerType: 'ATTORNEY',
        attorneyRole: 'DEFENDANT',
        searchType: 'opening',
        searchStartEvent,
        searchEndEvent,
        minWords: longStatementConfig.minWords || 400,
        maxInterruptionRatio: longStatementConfig.maxInterruptionRatio || 0.4,
        ratioMode: ratioMode as any,
        ratioThreshold,
        aggregateTeam: true,

        // V3 specific parameters
        trackEvaluations: true,
        outputDir: './output/longstatements',
        requireInitialThreshold: true,
        breakOnOpposingLongStatement: true,
        maxExtensionAttempts: 20,
        declineThreshold: 0.05,
        statementType: 'opening',
        displayWindowSize: 9,
        maxDisplayWords: 100
      };

      const defenseOpening = await this.longStatementsAccumulatorV3.findLongestStatement(defenseParams);

      let plaintiffOpening = null;
      let plaintiffRebuttal = null;

      if (defenseOpening) {
        // Search for plaintiff opening BEFORE defense
        const plaintiffParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF',
          searchEndEvent: defenseOpening.startEvent.id - 1
        };
        plaintiffOpening = await this.longStatementsAccumulatorV3.findLongestStatement(plaintiffParams);

        // Search for plaintiff rebuttal AFTER defense
        const rebuttalParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF',
          searchStartEvent: defenseOpening.endEvent.id + 1,
          minWords: Math.floor((longStatementConfig.minWords || 400) / 2), // Lower threshold for rebuttal
          maxInterruptionRatio: 0.5, // More lenient for rebuttal
          ratioThreshold: ratioThreshold * 0.8 // More lenient threshold
        };
        plaintiffRebuttal = await this.longStatementsAccumulatorV3.findLongestStatement(rebuttalParams);
      } else {
        // No defense found, search full window for plaintiff
        const plaintiffParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF'
        };
        plaintiffOpening = await this.longStatementsAccumulatorV3.findLongestStatement(plaintiffParams);
      }

      // Save all accumulated evaluations
      if (defenseParams.trackEvaluations) {
        await this.longStatementsAccumulatorV3.saveAllAccumulatedEvaluations(
          trialId,
          trial?.shortName || `trial_${trialId}`,
          'opening'
        );
      }

      const openingStatements: MarkerSection[] = [];

      // Create plaintiff opening section
      if (plaintiffOpening) {
        const po = plaintiffOpening;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.OPENING_STATEMENT_PLAINTIFF,
            name: 'Plaintiff Opening Statement',
            description: 'Opening statement by plaintiff counsel',
            startEventId: po.startEvent.id,
            endEventId: po.endEvent.id,
            startTime: po.startEvent.startTime,
            endTime: po.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: po.confidence,
            metadata: {
              totalWords: po.totalWords,
              speakerWords: po.speakerWords,
              speakerRatio: po.speakerRatio,
              algorithm: 'V3_DEFENSE_FIRST',
              ...po.metadata
            }
          }
        });
        openingStatements.push(section);
      }

      // Create defense opening section
      if (defenseOpening) {
        const do_ = defenseOpening;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.OPENING_STATEMENT_DEFENSE,
            name: 'Defense Opening Statement',
            description: 'Opening statement by defense counsel',
            startEventId: do_.startEvent.id,
            endEventId: do_.endEvent.id,
            startTime: do_.startEvent.startTime,
            endTime: do_.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: do_.confidence,
            metadata: {
              totalWords: do_.totalWords,
              speakerWords: do_.speakerWords,
              speakerRatio: do_.speakerRatio,
              algorithm: 'V3_DEFENSE_FIRST',
              ...do_.metadata
            }
          }
        });
        openingStatements.push(section);
      }

      // Create period section and return
      if (openingStatements.length > 0) {
        openingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
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
              childCount: openingStatements.length
            }
          }
        });

        // Update parent section IDs
        for (const stmt of openingStatements) {
          await this.prisma.markerSection.update({
            where: { id: stmt.id },
            data: { parentSectionId: openingPeriod.id }
          });
        }

        return openingPeriod;
      }

      return null;
    }

    // Use ArgumentFinder if enabled
    else if (this.useArgumentFinder) {
      this.logger.warn('[HIERARCHY STRATEGY] Using ArgumentFinder (LEGACY PATH) - should use V3 directly instead');

      // Get trial info for ArgumentFinder
      const trial = await this.prisma.trial.findUnique({
        where: { id: trialId },
        select: { shortName: true }
      });

      const config = {
        minWords: 400,
        maxInterruptionRatio: 0.4,
        ratioMode,
        ratioThreshold,
        trackEvaluations: true,
        trialName: trial?.shortName || `trial_${trialId}`,
        outputDir: './output/longstatements'
      };

      const results = await this.argumentFinder.findOpeningStatements(
        trialId,
        searchStartEvent,
        searchEndEvent,
        config
      );

      const openingStatements: MarkerSection[] = [];

      // Create plaintiff opening section
      if (results.plaintiffOpening) {
        const po = results.plaintiffOpening;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.OPENING_STATEMENT_PLAINTIFF,
            name: 'Plaintiff Opening Statement',
            description: 'Opening statement by plaintiff counsel',
            startEventId: po.startEvent.id,
            endEventId: po.endEvent.id,
            startTime: po.startEvent.startTime,
            endTime: po.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: po.confidence,
            metadata: {
              totalWords: po.totalWords,
              speakerWords: po.speakerWords,
              speakerRatio: po.speakerRatio,
              validationScore: po.validationScore,
              ...po.metadata
            }
          }
        });
        openingStatements.push(section);
      }

      // Create defense opening section
      if (results.defenseOpening) {
        const do_ = results.defenseOpening;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.OPENING_STATEMENT_DEFENSE,
            name: 'Defense Opening Statement',
            description: 'Opening statement by defense counsel',
            startEventId: do_.startEvent.id,
            endEventId: do_.endEvent.id,
            startTime: do_.startEvent.startTime,
            endTime: do_.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: do_.confidence,
            metadata: {
              totalWords: do_.totalWords,
              speakerWords: do_.speakerWords,
              speakerRatio: do_.speakerRatio,
              validationScore: do_.validationScore,
              ...do_.metadata
            }
          }
        });
        openingStatements.push(section);
      }

      // Create period section and return
      if (openingStatements.length > 0) {
        openingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
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
              hasPlaintiffOpening: !!results.plaintiffOpening,
              hasDefenseOpening: !!results.defenseOpening
            }
          }
        });

        for (const opening of openingStatements) {
          await this.prisma.markerSection.update({
            where: { id: opening.id },
            data: { parentSectionId: openingPeriod.id }
          });
        }

        return openingPeriod;
      }

      // If no openings found, fall through to legacy logic
      this.logger.info('ArgumentFinder found no opening statements, falling back to legacy logic');
    }


    // STEP 1: Find defense opening statement FIRST
    // (Usually comes second chronologically, but may be easier to detect)
    const defenseOpening = await this.longStatementsAccumulatorV3.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      searchEndEvent,
      minWords: 400,  // Slightly lower threshold
      maxInterruptionRatio: 0.4,
      ratioMode: ratioMode as any,
      ratioThreshold,
      aggregateTeam: true  // Enable team aggregation for split arguments
    });

    // STEP 2: Find plaintiff opening statement
    // Search in narrowed range if defense opening was found
    let plaintiffSearchEnd = searchEndEvent;
    if (defenseOpening && defenseOpening.confidence > 0.5) {
      // Plaintiff opening should come BEFORE defense opening
      plaintiffSearchEnd = defenseOpening.startEvent.id - 1;
    }

    const plaintiffOpening = await this.longStatementsAccumulatorV3.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      searchEndEvent: plaintiffSearchEnd,
      minWords: 400,
      maxInterruptionRatio: 0.4,
      ratioMode: ratioMode as any,
      ratioThreshold,
      aggregateTeam: true  // Enable team aggregation
    });

    const openingStatements: MarkerSection[] = [];

    // Create plaintiff opening section (lower confidence threshold for opening statements)
    if (plaintiffOpening && plaintiffOpening.confidence > 0.4) {
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

    // Create defense opening section (lower confidence threshold for opening statements)
    if (defenseOpening && defenseOpening.confidence > 0.4) {
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

    // Sort opening statements chronologically by startEventId
    openingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));

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

    // Create a default opening statements period just before witness testimony
    // This provides a reasonable placeholder until attorney roles are properly assigned
    if (testimonyPeriod?.startEventId) {
      // Find a reasonable range before witness testimony for the default opening period
      const defaultStartEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            gte: Math.max(searchStartEvent || 1, testimonyPeriod.startEventId - 100),
            lt: testimonyPeriod.startEventId
          }
        },
        orderBy: { id: 'asc' }
      });

      const defaultEndEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            lt: testimonyPeriod.startEventId
          }
        },
        orderBy: { id: 'desc' }
      });

      if (defaultStartEvent && defaultEndEvent) {
        return await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.OPENING_STATEMENTS_PERIOD,
            parentSectionId: trialSectionId,
            name: 'Opening Statements',
            description: 'Opening statements period (default placement)',
            startEventId: defaultStartEvent.id,
            endEventId: defaultEndEvent.id,
            startTime: defaultStartEvent.startTime,
            endTime: defaultEndEvent.endTime,
            source: MarkerSource.PHASE3_HIERARCHY,
            confidence: 0.3, // Low confidence for default placement
            metadata: {
              isDefault: true,
              reason: 'No opening statements detected - attorney roles may need assignment',
              hasPlaintiffOpening: false,
              hasDefenseOpening: false
            }
          }
        });
      }
    }

    // Fallback: Create zero-length section if we can't determine a reasonable range
    const placementEventId = testimonyPeriod?.startEventId ?
      testimonyPeriod.startEventId - 1 :
      undefined;

    return await this.createZeroLengthSection({
      trialId,
      sectionType: MarkerSectionType.OPENING_STATEMENTS_PERIOD,
      parentSectionId: trialSectionId,
      name: 'Opening Statements',
      description: 'No opening statements found',
      reason: 'Could not identify opening statements - attorney roles may need assignment',
      placementEventId
    });
  }

  /**
   * Find closing statements using LongStatementsAccumulator
   */
  private async findClosingStatements(
    trialId: number,
    trialSectionId: number,
    testimonyPeriod: MarkerSection | null
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding closing statements for trial ${trialId}`);

    // Get config parameters with defaults
    const longStatementConfig = this.trialStyleConfig?.longStatements || {};
    const ratioMode = longStatementConfig.ratioMode || 'WORD_RACE3';
    const ratioThreshold = longStatementConfig.ratioThreshold || 0.6;
    const minWords = longStatementConfig.minWords || 400;
    const maxInterruptionRatio = longStatementConfig.maxInterruptionRatio || 0.25;

    this.logger.info(`[HIERARCHY CONFIG] Using ratio mode: ${ratioMode}, threshold: ${ratioThreshold}, minWords: ${minWords}`);
    this.logger.info(`[HIERARCHY CONFIG] longStatementConfig: ${JSON.stringify(longStatementConfig)}`);

    // Initial search period: from end of testimony to end of trial
    const searchStartEvent = testimonyPeriod?.endEventId ? testimonyPeriod.endEventId + 1 : undefined;
    let searchEndEvent: number | undefined = undefined;

    // Get trial info for V3
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      select: { shortName: true }
    });

    // Use V3 Accumulator if enabled (with state tracking)
    if (this.useV3Accumulator) {
      this.logger.info('Using V3 Accumulator with state tracking for closing statements');

      // Clear any accumulated evaluations from previous searches
      this.longStatementsAccumulatorV3.clearAccumulatedEvaluations();

      // STEP 1: Find defense closing FIRST (as anchor point)
      const defenseParams: LongStatementParamsV3 = {
        trialId,
        trialName: trial?.shortName || `trial_${trialId}`,
        speakerType: 'ATTORNEY',
        attorneyRole: 'DEFENDANT',
        searchType: 'closing',
        searchStartEvent,
        searchEndEvent,
        minWords: longStatementConfig.minWordsClosing || minWords || 500,
        maxInterruptionRatio: longStatementConfig.maxInterruptionRatio || 0.3,
        ratioMode: ratioMode as any,
        ratioThreshold,
        aggregateTeam: true,
        trackEvaluations: true,
        outputDir: './output/longstatements',
        requireInitialThreshold: true,
        breakOnOpposingLongStatement: true,
        maxExtensionAttempts: 20,
        declineThreshold: 0.05,
        statementType: 'closing',
        displayWindowSize: 9,
        maxDisplayWords: 100
      };

      const defenseClosing = await this.longStatementsAccumulatorV3.findLongestStatement(defenseParams);

      let plaintiffClosing = null;
      let plaintiffRebuttal = null;

      if (defenseClosing) {
        // STEP 2: Search BEFORE defense for plaintiff main closing
        const plaintiffMainParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF',
          searchEndEvent: defenseClosing.startEvent.id - 1
        };
        plaintiffClosing = await this.longStatementsAccumulatorV3.findLongestStatement(plaintiffMainParams);

        // STEP 3: Search AFTER defense for plaintiff rebuttal
        const rebuttalParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF',
          searchStartEvent: defenseClosing.endEvent.id + 1,
          searchEndEvent: undefined,
          searchType: 'closing-rebuttal', // Specify this is a closing rebuttal search
          minWords: Math.floor((longStatementConfig.minWordsClosing || minWords || 500) * 0.6) // Lower threshold for rebuttal
        };
        plaintiffRebuttal = await this.longStatementsAccumulatorV3.findLongestStatement(rebuttalParams);
      } else {
        // No defense found, search full window for plaintiff
        const plaintiffParams: LongStatementParamsV3 = {
          ...defenseParams,
          attorneyRole: 'PLAINTIFF'
        };
        plaintiffClosing = await this.longStatementsAccumulatorV3.findLongestStatement(plaintiffParams);
      }

      // Save all accumulated evaluations for closing statements
      if (defenseParams.trackEvaluations) {
        await this.longStatementsAccumulatorV3.saveAllAccumulatedEvaluations(
          trialId,
          trial?.shortName || `trial_${trialId}`,
          'closing'
        );
      }

      const closingStatements: MarkerSection[] = [];

      // Create plaintiff closing section
      if (plaintiffClosing) {
        const pc = plaintiffClosing;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_STATEMENT_PLAINTIFF,
            name: 'Plaintiff Closing Statement',
            description: 'Main closing statement by plaintiff counsel',
            startEventId: pc.startEvent.id,
            endEventId: pc.endEvent.id,
            startTime: pc.startEvent.startTime,
            endTime: pc.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: pc.confidence,
            metadata: {
              totalWords: pc.totalWords,
              speakerWords: pc.speakerWords,
              speakerRatio: pc.speakerRatio,
              algorithm: 'V3_DEFENSE_FIRST',
              ...pc.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found plaintiff closing: events ${section.startEventId}-${section.endEventId}, confidence ${pc.confidence.toFixed(2)}`);
      }

      // Create defense closing section
      if (defenseClosing) {
        const dc = defenseClosing;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_STATEMENT_DEFENSE,
            name: 'Defense Closing Statement',
            description: 'Closing statement by defense counsel',
            startEventId: dc.startEvent.id,
            endEventId: dc.endEvent.id,
            startTime: dc.startEvent.startTime,
            endTime: dc.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: dc.confidence,
            metadata: {
              totalWords: dc.totalWords,
              speakerWords: dc.speakerWords,
              speakerRatio: dc.speakerRatio,
              algorithm: 'V3_DEFENSE_FIRST',
              ...dc.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found defense closing: events ${section.startEventId}-${section.endEventId}, confidence ${dc.confidence.toFixed(2)}`);
      }

      // Create plaintiff rebuttal section
      if (plaintiffRebuttal) {
        const pr = plaintiffRebuttal;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_REBUTTAL_PLAINTIFF,
            name: 'Plaintiff Rebuttal',
            description: 'Rebuttal closing by plaintiff counsel',
            startEventId: pr.startEvent.id,
            endEventId: pr.endEvent.id,
            startTime: pr.startEvent.startTime,
            endTime: pr.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: pr.confidence,
            metadata: {
              totalWords: pr.totalWords,
              speakerWords: pr.speakerWords,
              speakerRatio: pr.speakerRatio,
              algorithm: 'V3_DEFENSE_FIRST',
              isRebuttal: true,
              ...pr.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found plaintiff rebuttal: events ${section.startEventId}-${section.endEventId}, confidence ${pr.confidence.toFixed(2)}`);
      }

      // Create period section and return
      if (closingStatements.length > 0) {
        closingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
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
              childCount: closingStatements.length,
              hasRebuttal: !!plaintiffRebuttal
            }
          }
        });

        // Update parent section IDs
        for (const stmt of closingStatements) {
          await this.prisma.markerSection.update({
            where: { id: stmt.id },
            data: { parentSectionId: closingPeriod.id }
          });
        }

        return closingPeriod;
      }

      return null;
    }

    // Use ArgumentFinder if enabled
    else if (this.useArgumentFinder) {
      this.logger.warn('[HIERARCHY STRATEGY] Using ArgumentFinder (LEGACY PATH) - should use V3 directly instead');
      const config = {
        minWords,
        maxInterruptionRatio,
        ratioMode,
        ratioThreshold
      };

      const results = await this.argumentFinder.findClosingStatements(
        trialId,
        searchStartEvent,
        searchEndEvent,
        config
      );

      const closingStatements: MarkerSection[] = [];

      // Create plaintiff closing section
      if (results.plaintiffClosing) {
        const pc = results.plaintiffClosing;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_STATEMENT_PLAINTIFF,
            name: 'Plaintiff Closing Statement',
            description: 'Closing statement by plaintiff counsel',
            startEventId: pc.startEvent.id,
            endEventId: pc.endEvent.id,
            startTime: pc.startEvent.startTime,
            endTime: pc.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: pc.confidence,
            metadata: {
              totalWords: pc.totalWords,
              speakerWords: pc.speakerWords,
              speakerRatio: pc.speakerRatio,
              validationScore: pc.validationScore,
              ...pc.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found plaintiff closing: events ${section.startEventId}-${section.endEventId}, confidence ${pc.confidence.toFixed(2)}`);
      }

      // Create defense closing section
      if (results.defenseClosing) {
        const dc = results.defenseClosing;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_STATEMENT_DEFENSE,
            name: 'Defense Closing Statement',
            description: 'Closing statement by defense counsel',
            startEventId: dc.startEvent.id,
            endEventId: dc.endEvent.id,
            startTime: dc.startEvent.startTime,
            endTime: dc.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: dc.confidence,
            metadata: {
              totalWords: dc.totalWords,
              speakerWords: dc.speakerWords,
              speakerRatio: dc.speakerRatio,
              validationScore: dc.validationScore,
              ...dc.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found defense closing: events ${section.startEventId}-${section.endEventId}, confidence ${dc.confidence.toFixed(2)}`);
      }

      // Create plaintiff rebuttal section
      if (results.plaintiffRebuttal) {
        const pr = results.plaintiffRebuttal;
        const section = await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: MarkerSectionType.CLOSING_REBUTTAL_PLAINTIFF,
            name: 'Plaintiff Rebuttal',
            description: 'Rebuttal closing by plaintiff counsel',
            startEventId: pr.startEvent.id,
            endEventId: pr.endEvent.id,
            startTime: pr.startEvent.startTime,
            endTime: pr.endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: pr.confidence,
            metadata: {
              totalWords: pr.totalWords,
              speakerWords: pr.speakerWords,
              speakerRatio: pr.speakerRatio,
              validationScore: pr.validationScore,
              isRebuttal: true,
              ...pr.metadata
            }
          }
        });
        closingStatements.push(section);
        this.logger.info(`Found plaintiff rebuttal: events ${section.startEventId}-${section.endEventId}, confidence ${pr.confidence.toFixed(2)}`);
      }

      // Create period section and return
      if (closingStatements.length > 0) {
        closingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));
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
              hasDefenseClosing: closingStatements.some(s => s.markerSectionType === MarkerSectionType.CLOSING_STATEMENT_DEFENSE),
              hasPlaintiffRebuttal: closingStatements.some(s => s.markerSectionType === MarkerSectionType.CLOSING_REBUTTAL_PLAINTIFF)
            }
          }
        });

        for (const closing of closingStatements) {
          await this.prisma.markerSection.update({
            where: { id: closing.id },
            data: { parentSectionId: closingPeriod.id }
          });
        }

        return closingPeriod;
      }

      // If no closings found, fall through to legacy logic
      this.logger.info('ArgumentFinder found no closing statements, falling back to legacy logic');
    }


    // Search for all closing statements in the correct chronological order:
    // 1. Plaintiff closing (first)
    // 2. Defense closing (second)
    // 3. Plaintiff rebuttal (optional, third)

    // STEP 1: Find ALL attorney long statements after witness testimony
    const allClosingCandidates = [];

    // Find plaintiff statements
    const plaintiffStatements = await this.longStatementsAccumulatorV3.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      searchEndEvent,
      minWords: Math.floor(minWords * 0.8), // Slightly lower to catch more candidates
      maxInterruptionRatio: 0.3,
      ratioMode: ratioMode as any,
      ratioThreshold: ratioThreshold * 0.9,
      aggregateTeam: true
    });

    if (plaintiffStatements) {
      allClosingCandidates.push({ ...plaintiffStatements, role: 'PLAINTIFF' });
    }

    // Find defense statements
    const defenseStatements = await this.longStatementsAccumulatorV3.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      searchEndEvent,
      minWords: Math.floor(minWords * 0.8),
      maxInterruptionRatio: 0.3,
      ratioMode: ratioMode as any,
      ratioThreshold: ratioThreshold * 0.9,
      aggregateTeam: true
    });

    if (defenseStatements) {
      allClosingCandidates.push({ ...defenseStatements, role: 'DEFENDANT' });
    }

    // Sort candidates by their start event to get chronological order
    allClosingCandidates.sort((a, b) => a.startEvent.id - b.startEvent.id);

    // Now identify which is which based on order and role
    let plaintiffClosing = null;
    let defenseClosing = null;
    let plaintiffRebuttal = null;

    for (const candidate of allClosingCandidates) {
      if (candidate.role === 'PLAINTIFF' && !plaintiffClosing) {
        // First plaintiff statement is the main closing
        plaintiffClosing = candidate;
      } else if (candidate.role === 'DEFENDANT' && !defenseClosing) {
        // First defense statement is their closing
        defenseClosing = candidate;
      } else if (candidate.role === 'PLAINTIFF' && plaintiffClosing) {
        // Second plaintiff statement is rebuttal
        plaintiffRebuttal = candidate;
      }
    }

    // If we still don't have proper closings, do a more targeted search
    if (!plaintiffClosing || !defenseClosing) {
      // Search for specific high-word-count events in sequence
      const highWordEvents = await this.prisma.trialEvent.findMany({
        where: {
          trialId,
          id: { gte: searchStartEvent || 0 },
          eventType: 'STATEMENT',
          wordCount: { gte: minWords }
        },
        include: {
          statement: {
            include: { speaker: true }
          }
        },
        orderBy: { id: 'asc' },
        take: 10
      });

      this.logger.info(`Found ${highWordEvents.length} high word count events after witness testimony`);

      for (const event of highWordEvents) {
        const speaker = event.statement?.speaker?.speakerHandle;
        this.logger.debug(`  Event ${event.id}: ${speaker} - ${event.wordCount} words`);
      }
    }

    const closingStatements: MarkerSection[] = [];

    // Create plaintiff closing section (typically goes first)
    if (plaintiffClosing && plaintiffClosing.confidence > 0.5) {
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
            speakerRatio: plaintiffClosing.speakerRatio,
            ratioMode,
            ...(plaintiffClosing as any).metadata
          }
        }
      });
      closingStatements.push(section);
      this.logger.info(`Found plaintiff closing: events ${section.startEventId}-${section.endEventId}, confidence ${plaintiffClosing.confidence.toFixed(2)}`);
    }

    // Create defense closing section (typically goes second)
    if (defenseClosing && defenseClosing.confidence > 0.5) {
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
            speakerRatio: defenseClosing.speakerRatio,
            ratioMode
          }
        }
      });
      closingStatements.push(section);
      this.logger.info(`Found defense closing: events ${section.startEventId}-${section.endEventId}, confidence ${defenseClosing.confidence.toFixed(2)}`);
    }

    // Create plaintiff rebuttal section
    if (plaintiffRebuttal && plaintiffRebuttal.confidence > 0.4) {
      const section = await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CLOSING_REBUTTAL_PLAINTIFF,
          name: 'Plaintiff Rebuttal',
          description: 'Rebuttal closing by plaintiff counsel',
          startEventId: plaintiffRebuttal.startEvent.id,
          endEventId: plaintiffRebuttal.endEvent.id,
          startTime: plaintiffRebuttal.startEvent.startTime,
          endTime: plaintiffRebuttal.endEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: plaintiffRebuttal.confidence,
          metadata: {
            totalWords: plaintiffRebuttal.totalWords,
            speakerWords: plaintiffRebuttal.speakerWords,
            speakerRatio: plaintiffRebuttal.speakerRatio,
            isRebuttal: true,
            ratioMode,
            ...(plaintiffRebuttal as any).metadata
          }
        }
      });
      closingStatements.push(section);
      this.logger.info(`Found plaintiff rebuttal: events ${section.startEventId}-${section.endEventId}, confidence ${plaintiffRebuttal.confidence.toFixed(2)}`);
    }

    // Removed plaintiff rebuttal logic - not part of standard trial sequence

    // Sort closing statements chronologically by startEventId
    closingStatements.sort((a, b) => (a.startEventId || 0) - (b.startEventId || 0));

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

    // Default: Create a period from after witness testimony to end of trial
    // This will be adjusted if we find jury deliberation/verdict
    const lastEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { id: 'desc' }
    });

    const defaultStartEvent = testimonyPeriod?.endEventId ? testimonyPeriod.endEventId + 1 :
                              (lastEvent ? lastEvent.id - 100 : 1); // Fallback to last 100 events

    return await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.CLOSING_STATEMENTS_PERIOD,
        parentSectionId: trialSectionId,
        name: 'Closing Statements',
        description: 'Closing statements period (default bounds)',
        startEventId: defaultStartEvent,
        endEventId: lastEvent?.id,
        startTime: testimonyPeriod?.endTime,
        endTime: lastEvent?.endTime,
        source: MarkerSource.PHASE3_HIERARCHY,
        confidence: 0.3, // Low confidence for default
        metadata: {
          isDefault: true,
          hasPlaintiffClosing: false,
          hasDefenseClosing: false
        }
      }
    });
  }

  /**
   * Find jury selection period
   */
  private async findJurySelection(
    trialId: number,
    trialSectionId: number,
    testimonyPeriod: MarkerSection | null
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding jury selection for trial ${trialId}`);

    // Look for juror speech before witness testimony
    if (!testimonyPeriod || !testimonyPeriod.startEventId) {
      this.logger.info('No testimony period to search before for jury selection');
      return null;
    }

    const jurorStatements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          trialId,
          id: {
            lt: testimonyPeriod.startEventId
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
    jurySelection: MarkerSection | null,
    testimonyPeriod: MarkerSection | null
  ): Promise<MarkerSection> {
    this.logger.info(`Finding case introduction for trial ${trialId}`);

    // Get first event of trial
    const firstEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'asc' }
    });

    if (!firstEvent) {
      return await this.createZeroLengthSection({
        trialId,
        sectionType: MarkerSectionType.CASE_INTRO,
        parentSectionId: trialSectionId,
        name: 'Case Introduction',
        description: 'No case introduction found',
        reason: 'Unable to determine trial boundaries'
      });
    }

    // Determine end boundary based on what was found
    let endEventId: number | undefined;
    let endEvent: any = null;

    if (jurySelection && jurySelection.startEventId) {
      // If jury selection found, case intro ends before it
      endEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            lt: jurySelection.startEventId
          }
        },
        orderBy: {
          id: 'desc'
        }
      });
      endEventId = endEvent?.id;
    } else if (testimonyPeriod && testimonyPeriod.startEventId) {
      // No jury selection, case intro is entire pre-witness testimony period
      endEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            lt: testimonyPeriod.startEventId
          }
        },
        orderBy: {
          id: 'desc'
        }
      });
      endEventId = endEvent?.id;
    }

    // Create case introduction if we have valid boundaries
    if (endEventId && firstEvent.id <= endEventId) {
      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CASE_INTRO,
          parentSectionId: trialSectionId,
          name: 'Case Introduction',
          description: jurySelection ? 'Pre-trial proceedings before jury selection' : 'Pre-trial proceedings before witness testimony',
          startEventId: firstEvent.id,
          endEventId: endEventId,
          startTime: firstEvent.startTime,
          endTime: endEvent?.endTime || firstEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: 0.7,
          metadata: {
            endsAtJurySelection: !!jurySelection,
            endsAtWitnessTestimony: !jurySelection && !!testimonyPeriod
          }
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
    closingPeriod: MarkerSection | null
  ): Promise<MarkerSection | null> {
    this.logger.info(`Finding jury verdict for trial ${trialId}`);

    // Look for foreperson speech after closing statements
    if (!closingPeriod || !closingPeriod.endEventId) {
      this.logger.info('No closing period to search after for jury verdict');
      return null;
    }

    const forepersonStatements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          trialId,
          id: {
            gt: closingPeriod.endEventId
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
    closingPeriod: MarkerSection | null,
    verdictSection: MarkerSection | null
  ): Promise<MarkerSection | null> {
    // Jury deliberation only exists if we found a jury verdict
    // It's the period between closing statements and the verdict
    if (!verdictSection || !closingPeriod || !closingPeriod.endEventId || !verdictSection.startEventId) {
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
            description: 'Period between closing statements and jury verdict',
            startEventId: startEvent.id,
            endEventId: endEvent.id,
            startTime: startEvent.startTime,
            endTime: endEvent.endTime,
            source: MarkerSource.PHASE3_DISCOVERY,
            confidence: 0.7, // Increased confidence since verdict was found
            metadata: {
              eventCount: eventsInBetween,
              afterClosing: true,
              beforeVerdict: true
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
    verdictSection: MarkerSection | null,
    closingPeriod: MarkerSection | null
  ): Promise<MarkerSection | null> {
    // Get last event of trial
    const lastEvent = await this.prisma.trialEvent.findFirst({
      where: { trialId },
      orderBy: { ordinal: 'desc' }
    });

    if (!lastEvent) {
      return null;
    }

    let startEventId: number | undefined;
    let description: string = 'Case conclusion';

    if (verdictSection && verdictSection.endEventId) {
      // If jury verdict found, case wrapup is after verdict
      if (lastEvent.id <= verdictSection.endEventId) {
        return null; // No events after verdict
      }

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
        startEventId = startEvent.id;
        description = 'Post-verdict proceedings and case conclusion';
      }
    } else if (closingPeriod && closingPeriod.endEventId) {
      // No jury verdict found, case wrapup is everything after closing statements
      if (lastEvent.id <= closingPeriod.endEventId) {
        return null; // No events after closing
      }

      const startEvent = await this.prisma.trialEvent.findFirst({
        where: {
          trialId,
          id: {
            gt: closingPeriod.endEventId
          }
        },
        orderBy: { id: 'asc' }
      });

      if (startEvent) {
        startEventId = startEvent.id;
        description = 'Post-closing proceedings and case conclusion (no verdict found)';
      }
    } else {
      return null; // Need at least closing statements to determine case wrapup
    }

    if (startEventId) {
      const startEvent = await this.prisma.trialEvent.findUnique({
        where: { id: startEventId }
      });

      return await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: MarkerSectionType.CASE_WRAPUP,
          parentSectionId: trialSectionId,
          name: 'Case Wrapup',
          description,
          startEventId,
          endEventId: lastEvent.id,
          startTime: startEvent?.startTime,
          endTime: lastEvent.endTime,
          source: MarkerSource.PHASE3_DISCOVERY,
          confidence: verdictSection ? 0.8 : 0.6, // Higher confidence if verdict was found
          metadata: {
            hasVerdict: !!verdictSection,
            eventCount: await this.prisma.trialEvent.count({
              where: {
                trialId,
                id: {
                  gte: startEventId,
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
            name: `Session ${session.sessionHandle}`,
            description: `${session.sessionType} session on ${session.sessionDate}`,
            startEventId: firstEvent.id,
            endEventId: lastEvent.id,
            startTime: firstEvent.startTime,
            endTime: lastEvent.endTime,
            source: MarkerSource.PHASE3_HIERARCHY,
            confidence: 1.0,
            metadata: {
              sessionId: session.id,
              sessionHandle: session.sessionHandle,
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
   * Find or create a witness testimony section encompassing all examinations
   */
  private async createWitnessTestimonySection(
    examinations: MarkerSection[],
    trialId: number
  ): Promise<MarkerSection> {
    const firstExam = examinations[0];
    const lastExam = examinations[examinations.length - 1];

    // Extract witness name from examination names (e.g., "WitExam_Direct_LESLIE_D_BAYCH" -> "LESLIE_D_BAYCH")
    let witnessName: string | null = null;
    const nameMatch = firstExam.name?.match(/WitExam_(?:Direct|Cross|Redir|Recross)_(.+)/);
    if (nameMatch) {
      witnessName = nameMatch[1];
    }

    // First, try to find an existing WitTest_ section for this witness within this trial
    // The WitnessMarkerDiscovery should have already created these with proper names
    if (witnessName) {
      const existingSection = await this.prisma.markerSection.findFirst({
        where: {
          trialId,
          markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
          name: `WitTest_${witnessName}`
        }
      });

      if (existingSection) {
        this.logger.debug(`Found existing witness testimony section: ${existingSection.name}`);

        // Update the section bounds if our examinations extend beyond current bounds
        const needsUpdate =
          (firstExam.startEventId && existingSection.startEventId && firstExam.startEventId < existingSection.startEventId) ||
          (lastExam.endEventId && existingSection.endEventId && lastExam.endEventId > existingSection.endEventId);

        if (needsUpdate) {
          const updated = await this.prisma.markerSection.update({
            where: { id: existingSection.id },
            data: {
              startEventId: Math.min(existingSection.startEventId || firstExam.startEventId || 0, firstExam.startEventId || 0),
              endEventId: Math.max(existingSection.endEventId || lastExam.endEventId || 0, lastExam.endEventId || 0),
              startTime: firstExam.startTime,
              endTime: lastExam.endTime
            }
          });
        }

        // Update all examination sections to be children of this witness testimony section
        for (const exam of examinations) {
          await this.prisma.markerSection.update({
            where: { id: exam.id },
            data: { parentSectionId: existingSection.id }
          });
        }

        return existingSection;
      }
    }

    // If no existing section found, log a warning and create a generic one
    // This shouldn't happen if WitnessMarkerDiscovery ran properly
    this.logger.warn(`No existing WitTest_ section found for witness ${witnessName || 'unknown'}, creating generic section`);

    const newSection = await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: MarkerSectionType.WITNESS_TESTIMONY,
        name: witnessName ? `WitTest_${witnessName}` : 'Witness Testimony',
        description: witnessName ? `All testimony by ${witnessName.replace(/_/g, ' ')}` : 'Complete testimony of witness',
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

    // Update all examination sections to be children of this witness testimony section
    for (const exam of examinations) {
      await this.prisma.markerSection.update({
        where: { id: exam.id },
        data: { parentSectionId: newSection.id }
      });
    }

    return newSection;
  }

  /**
   * Categorize witnesses as plaintiff or defense
   */
  private async categorizeWitnesses(
    witnessSections: MarkerSection[]
  ): Promise<{ plaintiffWitnesses: MarkerSection[], defenseWitnesses: MarkerSection[] }> {
    const plaintiffWitnesses: MarkerSection[] = [];
    const defenseWitnesses: MarkerSection[] = [];

    // Look up actual witness caller from database
    for (const section of witnessSections) {
      // Extract witness ID from metadata or find witness by name
      const metadata = section.metadata as any;
      let witnessCaller: string | null = null;

      if (metadata?.witnessId) {
        // If we have witness ID in metadata, look it up
        const witness = await this.prisma.witness.findUnique({
          where: { id: metadata.witnessId }
        });
        witnessCaller = witness?.witnessCaller || null;
      } else if (section.name) {
        // Try to extract witness name from section name (e.g., "WitTest_LESLIE_D_BAYCH")
        const nameMatch = section.name.match(/WitTest_(.+)/);
        if (nameMatch) {
          // Convert underscores to spaces for database lookup
          // Section names use underscores, but database names use spaces
          const witnessNameFromSection = nameMatch[1].replace(/_/g, ' ');

          // Try exact match first
          let witness = await this.prisma.witness.findFirst({
            where: {
              trialId: section.trialId,
              name: witnessNameFromSection
            }
          });

          // If no exact match, try with underscores as spaces (common mismatch)
          if (!witness) {
            // Most witness names in DB have spaces, but section names use underscores
            // Also handle special characters like PH D vs PH_D
            const normalizedName = witnessNameFromSection
              .replace(/_/g, ' ')  // Replace underscores with spaces
              .replace(/\s+/g, ' ')  // Normalize multiple spaces
              .trim();

            witness = await this.prisma.witness.findFirst({
              where: {
                trialId: section.trialId,
                name: normalizedName
              }
            });
          }

          // If still no match, try more flexible search
          if (!witness) {
            const normalizedName = witnessNameFromSection.replace(/\s+/g, ' ').trim();
            witness = await this.prisma.witness.findFirst({
              where: {
                trialId: section.trialId,
                OR: [
                  { name: { contains: normalizedName } },
                  { displayName: { equals: normalizedName } },
                  { displayName: { contains: normalizedName } }
                ]
              }
            });
          }

          if (witness) {
            witnessCaller = witness.witnessCaller || null;
            metadata.witnessId = witness.id; // Store witness ID for future reference
            this.logger.info(`Matched witness ${witness.name} (caller: ${witness.witnessCaller}) for section ${section.name}`);
          } else {
            this.logger.error(`Could not find witness in database for section: ${section.name} (searched for: "${witnessNameFromSection}")`);
          }
        }
      }

      // Categorize based on witnessCaller
      if (witnessCaller === 'PLAINTIFF') {
        this.logger.info(`✓ Assigning ${section.name} to PLAINTIFF witnesses (witness caller: ${witnessCaller})`);
        plaintiffWitnesses.push(section);
      } else if (witnessCaller === 'DEFENDANT' || witnessCaller === 'DEFENSE') {
        this.logger.info(`✓ Assigning ${section.name} to DEFENSE witnesses (witness caller: ${witnessCaller})`);
        defenseWitnesses.push(section);
      } else {
        // If we can't determine, use position-based heuristic as fallback
        // Typically plaintiff witnesses come first
        this.logger.warn(`⚠ Could not determine witness caller for section ${section.name} (caller: ${witnessCaller}), using position-based heuristic`);
        if (plaintiffWitnesses.length === 0 ||
            (defenseWitnesses.length > 0 && plaintiffWitnesses.length > defenseWitnesses.length)) {
          plaintiffWitnesses.push(section);
        } else {
          defenseWitnesses.push(section);
        }
      }
    }

    this.logger.info(`Categorized witnesses: ${plaintiffWitnesses.length} plaintiff, ${defenseWitnesses.length} defense`);

    return {
      plaintiffWitnesses,
      defenseWitnesses
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
    this.logger.info(`Updating parent references for ${witnesses.length} witnesses to ${sectionType} section ${section.id}`);
    for (const witness of witnesses) {
      this.logger.debug(`  - Updating ${witness.name} (id: ${witness.id}) parent to ${section.id}`);
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
    placementEventId?: number;
  }): Promise<MarkerSection> {
    // Use provided placement event or find an appropriate insertion point
    let placementEvent: any;

    if (params.placementEventId) {
      placementEvent = await this.prisma.trialEvent.findUnique({
        where: { id: params.placementEventId }
      });
    }

    if (!placementEvent) {
      // Fallback: find middle of trial
      placementEvent = await this.prisma.trialEvent.findFirst({
        where: { trialId: params.trialId },
        skip: await this.prisma.trialEvent.count({ where: { trialId: params.trialId } }) / 2,
        orderBy: { ordinal: 'asc' }
      });
    }

    return await this.prisma.markerSection.create({
      data: {
        trialId: params.trialId,
        markerSectionType: params.sectionType,
        parentSectionId: params.parentSectionId,
        name: params.name,
        description: params.description,
        startEventId: placementEvent?.id,
        endEventId: placementEvent?.id,
        startTime: placementEvent?.startTime,
        endTime: placementEvent?.startTime, // Same as start for zero-length
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
   * Adjust closing period end boundary based on jury events
   * This ensures the closing period includes any rebuttal statements
   * but ends before jury deliberation/verdict
   */
  private async adjustClosingPeriodBounds(
    closingPeriod: MarkerSection,
    juryDeliberation: MarkerSection | null,
    juryVerdict: MarkerSection | null
  ): Promise<void> {
    this.logger.info(`Adjusting closing period bounds based on jury events`);

    // Find the earliest jury event
    let newEndEventId: number | undefined;

    if (juryDeliberation?.startEventId) {
      newEndEventId = juryDeliberation.startEventId - 1;
    } else if (juryVerdict?.startEventId) {
      newEndEventId = juryVerdict.startEventId - 1;
    }

    if (newEndEventId && closingPeriod.endEventId && newEndEventId < closingPeriod.endEventId) {
      // Get the actual event to update the time properly
      const newEndEvent = await this.prisma.trialEvent.findUnique({
        where: { id: newEndEventId }
      });

      if (newEndEvent) {
        // Update the closing period end boundary
        await this.prisma.markerSection.update({
          where: { id: closingPeriod.id },
          data: {
            endEventId: newEndEvent.id,
            endTime: newEndEvent.endTime,
            metadata: {
              ...(closingPeriod.metadata as any || {}),
              adjustedForJuryEvents: true,
              originalEndEventId: closingPeriod.endEventId
            }
          }
        });

        this.logger.info(`Adjusted closing period end from event ${closingPeriod.endEventId} to ${newEndEvent.id}`);

        // Also check if we need to expand the period to include rebuttal statements
        // Look for any attorney statements between current end and jury events
        const additionalStatements = await this.prisma.statementEvent.findMany({
          where: {
            event: {
              trialId: closingPeriod.trialId,
              id: {
                gt: closingPeriod.endEventId || 0,
                lt: newEndEventId
              }
            },
            speaker: {
              speakerType: 'ATTORNEY'
            }
          },
          include: {
            event: true
          },
          orderBy: {
            event: {
              id: 'desc'
            }
          },
          take: 1
        });

        if (additionalStatements.length > 0) {
          const lastAttorneyStatement = additionalStatements[0];
          if (lastAttorneyStatement.eventId > (closingPeriod.endEventId || 0)) {
            // Extend closing period to include this statement
            await this.prisma.markerSection.update({
              where: { id: closingPeriod.id },
              data: {
                endEventId: lastAttorneyStatement.eventId,
                endTime: lastAttorneyStatement.event.endTime,
                metadata: {
                  ...(closingPeriod.metadata as any || {}),
                  includedRebuttal: true,
                  adjustedForJuryEvents: true
                }
              }
            });
            this.logger.info(`Extended closing period to include rebuttal at event ${lastAttorneyStatement.eventId}`);
          }
        }
      }
    } else {
      this.logger.info(`No adjustment needed for closing period bounds`);
    }
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
   * Find the actual end of witness testimony by looking for the last witness statement
   * This is critical for correct closing statement detection
   */
  private async findActualEndOfWitnessTestimony(
    trialId: number,
    currentEndEventId: number | null
  ): Promise<number | null> {
    if (!currentEndEventId) {
      return null;
    }

    this.logger.info('Finding actual end of witness testimony period');

    // Query for the last statement by any witness in the trial
    const lastWitnessStatement = await this.prisma.trialEvent.findFirst({
      where: {
        trialId,
        eventType: 'STATEMENT',
        statement: {
          speaker: {
            speakerType: 'WITNESS'
          }
        }
      },
      orderBy: {
        id: 'desc'
      },
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      }
    });

    if (lastWitnessStatement) {
      this.logger.info(`Found last witness statement at event ${lastWitnessStatement.id} by ${lastWitnessStatement.statement?.speaker?.speakerHandle}`);

      // If the last witness statement is before the current end, use it
      if (lastWitnessStatement.id < currentEndEventId) {
        this.logger.info(`Correcting witness testimony end from ${currentEndEventId} to ${lastWitnessStatement.id}`);
        return lastWitnessStatement.id;
      }
    }

    return currentEndEventId;
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