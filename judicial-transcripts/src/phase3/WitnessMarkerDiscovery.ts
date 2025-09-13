import { PrismaClient, MarkerType, MarkerSectionType, MarkerSource, TrialEvent, WitnessCalledEvent, Witness, ExaminationType } from '@prisma/client';
import { Logger } from '../utils/logger';

interface WitnessExaminationBoundary {
  witnessCalledEvent: WitnessCalledEvent & {
    event: TrialEvent;
    witness: Witness | null;
  };
  startEvent: TrialEvent;
  endEvent: TrialEvent | null;
}

export class WitnessMarkerDiscovery {
  private logger = new Logger('WitnessMarkerDiscovery');

  constructor(private prisma: PrismaClient) {}

  /**
   * Discover and create witness markers for a trial
   */
  async discoverWitnessMarkers(trialId: number): Promise<void> {
    this.logger.info(`Discovering witness markers for trial ${trialId}`);

    // Load witness called events
    const witnessEvents = await this.prisma.witnessCalledEvent.findMany({
      where: {
        event: {
          trialId
        }
      },
      include: {
        event: true,
        witness: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: {
        eventId: 'asc'  // Order by event ID to maintain chronological order across days
      }
    });

    if (witnessEvents.length === 0) {
      this.logger.info('No witness events found');
      return;
    }

    // Load all trial events for boundary detection
    // Order by ID to maintain creation order, not chronological order
    const allEvents = await this.prisma.trialEvent.findMany({
      where: { trialId },
      orderBy: { id: 'asc' },  // Order by ID to maintain creation sequence
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      }
    });

    // Process each witness examination
    const examinationBoundaries: WitnessExaminationBoundary[] = [];
    let lastProcessedTime: string | null = null;
    
    for (let i = 0; i < witnessEvents.length; i++) {
      const witnessEvent = witnessEvents[i];
      const nextWitnessEvent = i < witnessEvents.length - 1 ? witnessEvents[i + 1] : null;
      
      const boundary = await this.findExaminationBoundary(
        witnessEvent,
        nextWitnessEvent,
        allEvents
      );
      
      // Validate that end event ID is not before start event ID
      if (boundary.endEvent && boundary.endEvent.id < boundary.startEvent.id) {
        this.logger.error(`End event ID before start event ID for witness ${witnessEvent.witness?.name || 'Unknown'}! Start ID: ${boundary.startEvent.id}, End ID: ${boundary.endEvent.id}`);
        // Log but don't throw - we'll handle this in the MarkerSection creation
        // by using the start event as the end event in this case
        boundary.endEvent = boundary.startEvent;
      }
      
      examinationBoundaries.push(boundary);
      lastProcessedTime = boundary.endEvent?.startTime || boundary.startEvent.startTime;
    }

    // Create examination markers
    for (const boundary of examinationBoundaries) {
      await this.createExaminationMarkers(boundary, trialId);
    }

    // Create overall witness testimony markers
    await this.createWitnessTestimonyMarkers(examinationBoundaries, trialId);

    // Create complete witness testimony marker section
    await this.createCompleteWitnessTestimonyMarker(examinationBoundaries, trialId);

    this.logger.info(`Completed witness marker discovery for trial ${trialId}`);
  }

  /**
   * Find the boundary events for a witness examination
   */
  private async findExaminationBoundary(
    witnessEvent: any,
    nextWitnessEvent: any | null,
    allEvents: any[]
  ): Promise<WitnessExaminationBoundary> {
    const startEvent = witnessEvent.event;
    let endEvent: TrialEvent | null = null;

    // Special handling for video depositions - no Q&A in transcript
    // Set both start and end to the same event
    if (witnessEvent.examinationType === 'VIDEO_DEPOSITION') {
      this.logger.debug(`Video deposition detected for witness ${witnessEvent.witness?.name || 'Unknown'} - using same event for start and end`);
      return {
        witnessCalledEvent: witnessEvent,
        startEvent,
        endEvent: startEvent // Use same event for both markers
      };
    }

    // Find the constraining event (next witness or end of session)
    const startIndex = allEvents.findIndex(e => e.id === startEvent.id);
    const constraintIndex = nextWitnessEvent
      ? allEvents.findIndex(e => e.id === nextWitnessEvent.event.id)
      : allEvents.length;

    // Search backwards from constraint to find last answer from witness
    if (witnessEvent.witness && witnessEvent.witness.speaker) {
      for (let i = constraintIndex - 1; i > startIndex; i--) {
        const event = allEvents[i];
        if (
          event.eventType === 'STATEMENT' &&
          event.statement &&
          event.statement.speaker &&
          event.statement.speaker.speakerPrefix === 'A.' &&
          event.statement.speaker.id === witnessEvent.witness.speaker.id
        ) {
          endEvent = event;
          break;
        }
      }
    }
    
    // If no answer found with 'A.' prefix, try to find by witness speaker type
    if (!endEvent && witnessEvent.witness) {
      // Look for last statement by witness (may not have 'A.' prefix)
      const witnessName = witnessEvent.witness.name;
      if (witnessName) {
        for (let i = constraintIndex - 1; i > startIndex; i--) {
          const event = allEvents[i];
          if (
            event.eventType === 'STATEMENT' &&
            event.statement &&
            event.statement.speaker &&
            event.statement.speaker.speakerType === 'WITNESS' &&
            event.statement.speaker.speakerHandle.includes(witnessName.split(' ').pop())
          ) {
            endEvent = event;
            break;
          }
        }
      }
    }

    // For the last witness, find the last time this witness speaks
    // This is critical for correctly identifying where witness testimony ends
    if (!endEvent && !nextWitnessEvent) {
      this.logger.debug('Finding end of last witness testimony - looking for last witness statement');

      // Search for the last statement by ANY witness (not just this one)
      // This helps identify the true end of witness testimony period
      let lastWitnessStatementIndex = -1;

      for (let i = startIndex + 1; i < allEvents.length; i++) {
        const event = allEvents[i];
        if (
          event.eventType === 'STATEMENT' &&
          event.statement?.speaker?.speakerType === 'WITNESS'
        ) {
          lastWitnessStatementIndex = i;
        }
      }

      if (lastWitnessStatementIndex > startIndex) {
        endEvent = allEvents[lastWitnessStatementIndex];
        this.logger.info(`Found last witness statement at event ${endEvent?.id} for ${witnessEvent.witness?.name || 'Unknown'}`);
      } else {
        // If no witness statements found after this point, look for attorney block
        let attorneyBlockStart = -1;
        let consecutiveAttorneyCount = 0;

        for (let i = startIndex + 1; i < Math.min(constraintIndex, startIndex + 500); i++) {
          const event = allEvents[i];
          if (event.statement?.speaker?.speakerType === 'ATTORNEY') {
            consecutiveAttorneyCount++;
            if (consecutiveAttorneyCount >= 3 && attorneyBlockStart === -1) {
              attorneyBlockStart = i - 2; // Back up to start of attorney block
              break;
            }
          }
        }

        if (attorneyBlockStart > startIndex + 1) {
          endEvent = allEvents[attorneyBlockStart - 1];
          this.logger.info(`Using attorney block boundary for last witness end at event ${endEvent?.id}`);
        }
      }
    }

    // If still no end found and not the last witness, use the event before constraint
    if (!endEvent && nextWitnessEvent && constraintIndex > startIndex + 1) {
      endEvent = allEvents[constraintIndex - 1];
    }

    return {
      witnessCalledEvent: witnessEvent,
      startEvent,
      endEvent
    };
  }

  /**
   * Create markers for a witness examination
   */
  private async createExaminationMarkers(
    boundary: WitnessExaminationBoundary,
    trialId: number
  ): Promise<void> {
    const witness = boundary.witnessCalledEvent.witness;
    const examinationType = boundary.witnessCalledEvent.examinationType;
    
    // Use witness fingerprint instead of ID for more meaningful names
    const witnessFingerprint = witness?.witnessFingerprint || witness?.name?.replace(/[^a-zA-Z0-9]/g, '') || `W${witness?.id || 'Unknown'}`;
    const witnessHandle = witnessFingerprint;
    const witnessName = witness?.displayName || witness?.name || 'Unknown Witness';

    // Create start marker
    const startMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'SECTION_START',
        sectionType: 'WITNESS_EXAMINATION',
        eventId: boundary.startEvent.id,
        name: `WitExam_${this.getExamAbbreviation(examinationType)}_${witnessHandle}_Start`,
        description: `Start of ${examinationType} for witness ${witnessName}`,
        source: 'AUTO_EVENT',
        metadata: {
          witnessId: witness?.id,
          examinationType,
          continued: boundary.witnessCalledEvent.continued
        }
      }
    });

    // Create end marker if we found the end
    let endMarker = null;
    if (boundary.endEvent) {
      endMarker = await this.prisma.marker.create({
        data: {
          trialId,
          markerType: 'SECTION_END',
          sectionType: 'WITNESS_EXAMINATION',
          eventId: boundary.endEvent.id,
          name: `WitExam_${this.getExamAbbreviation(examinationType)}_${witnessHandle}_End`,
          description: `End of ${examinationType} for witness ${witnessName}`,
          source: 'AUTO_EVENT',
          metadata: {
            witnessId: witness?.id,
            examinationType
          }
        }
      });
    }

    // Create marker section
    if (startMarker) {
      // With Phase 2 changes, endTime should always be populated
      const endEventId = boundary.endEvent?.id || boundary.startEvent.id;
      const endTime = boundary.endEvent?.endTime || boundary.startEvent.endTime || boundary.startEvent.startTime;
      
      await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: 'WITNESS_EXAMINATION',
          source: MarkerSource.PHASE3_DISCOVERY,
          startMarkerId: startMarker.id,
          endMarkerId: endMarker?.id,
          startEventId: boundary.startEvent.id,
          endEventId: endEventId,
          startTime: boundary.startEvent.startTime,
          endTime: endTime,
          name: `WitExam_${this.getExamAbbreviation(examinationType)}_${witnessHandle}`,
          description: `${examinationType} of witness ${witnessName}`,
          metadata: {
            witnessId: witness?.id,
            examinationType,
            witnessName,
            witnessHandle
          }
        }
      });
    }
  }

  /**
   * Create overall witness testimony markers (spanning all examinations for a witness)
   */
  private async createWitnessTestimonyMarkers(
    boundaries: WitnessExaminationBoundary[],
    trialId: number
  ): Promise<void> {
    // Group boundaries by witness
    const witnessBoundaries = new Map<number, WitnessExaminationBoundary[]>();
    
    for (const boundary of boundaries) {
      const witnessId = boundary.witnessCalledEvent.witness?.id;
      if (witnessId) {
        if (!witnessBoundaries.has(witnessId)) {
          witnessBoundaries.set(witnessId, []);
        }
        witnessBoundaries.get(witnessId)!.push(boundary);
      }
    }

    // Create testimony markers for each witness
    for (const [witnessId, witnessBounds] of witnessBoundaries) {
      if (witnessBounds.length === 0) continue;

      const firstBoundary = witnessBounds[0];
      const lastBoundary = witnessBounds[witnessBounds.length - 1];
      
      const witness = firstBoundary.witnessCalledEvent.witness;
      // Use witness fingerprint instead of ID for more meaningful names
      const witnessFingerprint = witness?.witnessFingerprint || witness?.name?.replace(/[^a-zA-Z0-9]/g, '') || `W${witness?.id || 'Unknown'}`;
      const witnessHandle = witnessFingerprint;
      const witnessName = witness?.displayName || witness?.name || 'Unknown Witness';

      // Create start marker (same as first examination start)
      const startMarker = await this.prisma.marker.create({
        data: {
          trialId,
          markerType: 'SECTION_START',
          sectionType: 'WITNESS_TESTIMONY',
          eventId: firstBoundary.startEvent.id,
          name: `WitTest_${witnessHandle}_Start`,
          description: `Start of testimony for witness ${witnessName}`,
          source: 'AUTO_EVENT',
          metadata: {
            witnessId,
            witnessName,
            totalExaminations: witnessBounds.length
          }
        }
      });

      // Create end marker (same as last examination end)
      let endMarker = null;
      if (lastBoundary.endEvent) {
        endMarker = await this.prisma.marker.create({
          data: {
            trialId,
            markerType: 'SECTION_END',
            sectionType: 'WITNESS_TESTIMONY',
            eventId: lastBoundary.endEvent.id,
            name: `WitTest_${witnessHandle}_End`,
            description: `End of testimony for witness ${witnessName}`,
            source: 'AUTO_EVENT',
            metadata: {
              witnessId,
              witnessName,
              totalExaminations: witnessBounds.length
            }
          }
        });
      }

      // Create marker section
      if (startMarker && endMarker) {
        await this.prisma.markerSection.create({
          data: {
            trialId,
            markerSectionType: 'WITNESS_TESTIMONY',
            source: MarkerSource.PHASE3_DISCOVERY,
            startMarkerId: startMarker.id,
            endMarkerId: endMarker.id,
            startEventId: firstBoundary.startEvent.id,
            endEventId: lastBoundary.endEvent?.id,
            startTime: firstBoundary.startEvent.startTime,
            endTime: lastBoundary.endEvent?.endTime,
            name: `WitTest_${witnessHandle}`,
            description: `Complete testimony of witness ${witnessName}`,
            metadata: {
              witnessId,
              witnessName,
              witnessHandle,
              examinations: witnessBounds.map(b => b.witnessCalledEvent.examinationType)
            }
          }
        });
      }
    }
  }

  /**
   * Create a marker section encompassing all witness testimony
   */
  private async createCompleteWitnessTestimonyMarker(
    boundaries: WitnessExaminationBoundary[],
    trialId: number
  ): Promise<void> {
    if (boundaries.length === 0) return;

    const firstBoundary = boundaries[0];
    const lastBoundary = boundaries[boundaries.length - 1];

    // Create start marker
    const startMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'SECTION_START',
        sectionType: 'COMPLETE_WITNESS_TESTIMONY',
        eventId: firstBoundary.startEvent.id,
        name: 'CompleteWitTest_Start',
        description: 'Start of all witness testimony',
        source: 'AUTO_EVENT',
        metadata: {
          totalWitnesses: new Set(boundaries.map(b => b.witnessCalledEvent.witnessId)).size,
          totalExaminations: boundaries.length
        }
      }
    });

    // Create end marker
    let endMarker = null;
    if (lastBoundary.endEvent) {
      endMarker = await this.prisma.marker.create({
        data: {
          trialId,
          markerType: 'SECTION_END',
          sectionType: 'COMPLETE_WITNESS_TESTIMONY',
          eventId: lastBoundary.endEvent.id,
          name: 'CompleteWitTest_End',
          description: 'End of all witness testimony',
          source: 'AUTO_EVENT',
          metadata: {
            totalWitnesses: new Set(boundaries.map(b => b.witnessCalledEvent.witnessId)).size,
            totalExaminations: boundaries.length
          }
        }
      });
    }

    // Create marker section
    if (startMarker && endMarker) {
      await this.prisma.markerSection.create({
        data: {
          trialId,
          markerSectionType: 'COMPLETE_WITNESS_TESTIMONY',
          source: MarkerSource.PHASE3_DISCOVERY,
          startMarkerId: startMarker.id,
          endMarkerId: endMarker.id,
          startEventId: firstBoundary.startEvent.id,
          endEventId: lastBoundary.endEvent?.id,
          startTime: firstBoundary.startEvent.startTime,
          endTime: lastBoundary.endEvent?.endTime,
          name: 'CompleteWitnessTestimony',
          description: 'All witness testimony in the trial',
          metadata: {
            witnesses: boundaries
              .map(b => b.witnessCalledEvent.witness)
              .filter(w => w)
              .map(w => ({
                id: w!.id,
                name: w!.displayName || w!.name
              }))
          }
        }
      });
    }
  }
  
  /**
   * Get abbreviated examination type
   */
  private getExamAbbreviation(examinationType: string): string {
    switch (examinationType) {
      case 'DIRECT_EXAMINATION':
        return 'Direct';
      case 'CROSS_EXAMINATION':
        return 'Cross';
      case 'REDIRECT_EXAMINATION':
        return 'Redir';
      case 'RECROSS_EXAMINATION':
        return 'Recross';
      case 'VIDEO_DEPOSITION':
        return 'VideoDep';
      default:
        return examinationType.replace(/_EXAMINATION$/, '').replace(/_/g, '');
    }
  }
}