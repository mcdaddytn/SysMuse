import { 
  PrismaClient, 
  Speaker, 
  Attorney, 
  Witness, 
  Judge, 
  Juror,
  SpeakerType,
  AttorneyRole,
  WitnessType,
  WitnessCaller,
  SwornStatus
} from '@prisma/client';
import logger from '../utils/logger';

export interface CreateSpeakerData {
  speakerPrefix: string;
  speakerType: SpeakerType;
  speakerHandle?: string;
}

export interface CreateAttorneyData {
  name: string;
  title?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  suffix?: string;
  speakerPrefix?: string;
  barNumber?: string;
  role: AttorneyRole;
  lawFirmName?: string;
}

export interface CreateWitnessData {
  name?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  suffix?: string;
  displayName?: string;
  witnessType?: WitnessType;
  witnessCaller?: WitnessCaller;
  expertField?: string;
  swornStatus?: SwornStatus;
}

export class MultiTrialSpeakerService {
  constructor(
    private prisma: PrismaClient,
    private trialId: number
  ) {}

  async createSpeaker(
    data: CreateSpeakerData
  ): Promise<Speaker> {
    const handle = data.speakerHandle || this.generateHandle(data.speakerPrefix);
    
    // Check if speaker already exists for this trial
    const existing = await this.prisma.speaker.findFirst({
      where: {
        trialId: this.trialId,
        OR: [
          { speakerPrefix: data.speakerPrefix },
          { speakerHandle: handle }
        ]
      }
    });
    
    if (existing) {
      logger.debug(`Speaker already exists: ${data.speakerPrefix} for trial ${this.trialId}`);
      return existing;
    }
    
    logger.info(`Creating speaker: ${data.speakerPrefix} (${data.speakerType}) for trial ${this.trialId}`);
    
    return this.prisma.speaker.create({
      data: {
        trialId: this.trialId,
        speakerPrefix: data.speakerPrefix,
        speakerHandle: handle,
        speakerType: data.speakerType
      }
    });
  }

  async createAttorneyWithSpeaker(
    data: CreateAttorneyData
  ): Promise<{ attorney: Attorney; speaker: Speaker }> {
    // First check if attorney exists for this trial
    const existingAttorney = await this.prisma.attorney.findFirst({
      where: {
        name: data.name,
        trialAttorneys: {
          some: { trialId: this.trialId }
        }
      },
      include: {
        speaker: true
      }
    });
    
    if (existingAttorney && existingAttorney.speaker) {
      logger.debug(`Attorney already exists: ${data.name} for trial ${this.trialId}`);
      return {
        attorney: existingAttorney,
        speaker: existingAttorney.speaker
      };
    }
    
    // Create speaker first
    const speakerPrefix = data.speakerPrefix || 
      `${data.title || 'MR.'} ${data.lastName || data.name}`.toUpperCase();
    
    const speaker = await this.createSpeaker({
      speakerPrefix,
      speakerType: 'ATTORNEY'
    });
    
    // Create or update attorney
    const attorney = await this.prisma.attorney.upsert({
      where: {
        speakerId: speaker.id
      },
      update: {
        name: data.name,
        title: data.title,
        firstName: data.firstName,
        middleInitial: data.middleInitial,
        lastName: data.lastName,
        suffix: data.suffix,
        speakerPrefix: data.speakerPrefix
      },
      create: {
        name: data.name,
        title: data.title,
        firstName: data.firstName,
        middleInitial: data.middleInitial,
        lastName: data.lastName,
        suffix: data.suffix,
        speakerPrefix: data.speakerPrefix,
        barNumber: data.barNumber,
        speakerId: speaker.id
      }
    });
    
    // Create trial association
    await this.associateAttorneyWithTrial(attorney.id, data.role, data.lawFirmName);
    
    logger.info(`Created attorney: ${data.name} with speaker ${speakerPrefix} for trial ${this.trialId}`);
    
    return { attorney, speaker };
  }

  async createWitnessWithSpeaker(
    data: CreateWitnessData
  ): Promise<{ witness: Witness; speaker: Speaker }> {
    const displayName = data.displayName || data.name || 
      `${data.firstName || ''} ${data.lastName || ''}`.trim();
    
    // Check if witness exists for this trial
    const existingWitness = await this.prisma.witness.findFirst({
      where: {
        trialId: this.trialId,
        OR: [
          { name: data.name },
          { displayName: displayName }
        ]
      },
      include: {
        speaker: true
      }
    });
    
    if (existingWitness && existingWitness.speaker) {
      logger.debug(`Witness already exists: ${displayName} for trial ${this.trialId}`);
      return {
        witness: existingWitness,
        speaker: existingWitness.speaker
      };
    }
    
    // Create speaker
    const speaker = await this.createSpeaker({
      speakerPrefix: displayName.toUpperCase(),
      speakerType: 'WITNESS'
    });
    
    // Create witness
    const witness = await this.prisma.witness.create({
      data: {
        trialId: this.trialId,
        name: data.name,
        firstName: data.firstName,
        middleInitial: data.middleInitial,
        lastName: data.lastName,
        suffix: data.suffix,
        displayName: displayName,
        witnessType: data.witnessType,
        witnessCaller: data.witnessCaller,
        expertField: data.expertField,
        swornStatus: data.swornStatus || 'NOT_SWORN',
        speakerId: speaker.id
      }
    });
    
    logger.info(`Created witness: ${displayName} for trial ${this.trialId}`);
    
    return { witness, speaker };
  }

  async createJudgeWithSpeaker(
    name: string,
    title?: string,
    honorific?: string
  ): Promise<{ judge: Judge; speaker: Speaker }> {
    // Check if judge exists for this trial
    const existingJudge = await this.prisma.judge.findUnique({
      where: { trialId: this.trialId },
      include: { speaker: true }
    });
    
    if (existingJudge) {
      logger.debug(`Judge already exists for trial ${this.trialId}`);
      if (!existingJudge.speaker) {
        // Create speaker for existing judge
        const speaker = await this.createSpeaker({
          speakerPrefix: 'THE COURT',
          speakerType: 'JUDGE'
        });
        
        // Update judge with speaker
        const updatedJudge = await this.prisma.judge.update({
          where: { id: existingJudge.id },
          data: { speakerId: speaker.id }
        });
        
        return {
          judge: updatedJudge,
          speaker: speaker
        };
      }
      return {
        judge: existingJudge,
        speaker: existingJudge.speaker
      };
    }
    
    // Create speaker for judge
    const speaker = await this.createSpeaker({
      speakerPrefix: 'THE COURT',
      speakerType: 'JUDGE'
    });
    
    // Create judge
    const judge = await this.prisma.judge.create({
      data: {
        trialId: this.trialId,
        name,
        title: title || 'JUDGE',
        honorific: honorific || 'HONORABLE',
        speakerId: speaker.id
      }
    });
    
    logger.info(`Created judge: ${name} for trial ${this.trialId}`);
    
    return { judge, speaker };
  }

  async createJurorWithSpeaker(
    jurorNumber: number,
    name?: string,
    lastName?: string
  ): Promise<{ juror: Juror; speaker: Speaker }> {
    const speakerPrefix = `JUROR NO. ${jurorNumber}`;
    
    // Check if juror exists
    const existingJuror = await this.prisma.juror.findFirst({
      where: {
        trialId: this.trialId,
        jurorNumber
      },
      include: { speaker: true }
    });
    
    if (existingJuror) {
      return {
        juror: existingJuror,
        speaker: existingJuror.speaker
      };
    }
    
    // Create speaker
    const speaker = await this.createSpeaker({
      speakerPrefix,
      speakerType: 'JUROR'
    });
    
    // Create juror
    const juror = await this.prisma.juror.create({
      data: {
        trialId: this.trialId,
        speakerId: speaker.id,
        jurorNumber,
        name,
        lastName,
        alias: speakerPrefix
      }
    });
    
    logger.info(`Created juror: ${speakerPrefix} for trial ${this.trialId}`);
    
    return { juror, speaker };
  }

  async findSpeaker(
    prefix: string
  ): Promise<Speaker | null> {
    return this.prisma.speaker.findFirst({
      where: {
        trialId: this.trialId,
        OR: [
          { speakerPrefix: prefix },
          { speakerHandle: this.generateHandle(prefix) }
        ]
      }
    });
  }

  async findAttorneyByName(
    name: string
  ): Promise<Attorney | null> {
    return this.prisma.attorney.findFirst({
      where: {
        trialAttorneys: {
          some: { trialId: this.trialId }
        },
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { lastName: { equals: name, mode: 'insensitive' } }
        ]
      }
    });
  }

  async findWitnessByName(
    name: string
  ): Promise<Witness | null> {
    return this.prisma.witness.findFirst({
      where: {
        trialId: this.trialId,
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { displayName: { contains: name, mode: 'insensitive' } },
          { lastName: { equals: name, mode: 'insensitive' } }
        ]
      }
    });
  }

  async associateAttorneyWithTrial(
    attorneyId: number,
    role: AttorneyRole,
    lawFirmName?: string
  ): Promise<void> {
    // Find or create law firm if provided
    let lawFirmId: number | undefined;
    if (lawFirmName) {
      // First try to find existing law firm
      let lawFirm = await this.prisma.lawFirm.findFirst({
        where: { name: lawFirmName }
      });
      
      // Create if not found
      if (!lawFirm) {
        lawFirm = await this.prisma.lawFirm.create({
          data: { name: lawFirmName }
        });
      }
      
      lawFirmId = lawFirm.id;
    }
    
    // Create trial-attorney association
    await this.prisma.trialAttorney.upsert({
      where: {
        trialId_attorneyId: {
          trialId: this.trialId,
          attorneyId
        }
      },
      update: {
        role,
        lawFirmId
      },
      create: {
        trialId: this.trialId,
        attorneyId,
        role,
        lawFirmId
      }
    });
  }

  async getAllSpeakersForTrial(): Promise<Speaker[]> {
    return this.prisma.speaker.findMany({
      where: { trialId: this.trialId },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true,
        anonymousSpeaker: true
      }
    });
  }

  async getUnmatchedSpeakers(): Promise<Speaker[]> {
    return this.prisma.speaker.findMany({
      where: {
        trialId: this.trialId,
        speakerType: { in: ['UNKNOWN', 'ANONYMOUS'] }
      }
    });
  }

  async updateSpeakerType(
    speakerId: number,
    newType: SpeakerType
  ): Promise<Speaker> {
    // Verify speaker belongs to this trial
    const speaker = await this.prisma.speaker.findFirst({
      where: {
        id: speakerId,
        trialId: this.trialId
      }
    });
    
    if (!speaker) {
      throw new Error(`Speaker ${speakerId} not found in trial ${this.trialId}`);
    }
    
    return this.prisma.speaker.update({
      where: { id: speakerId },
      data: { speakerType: newType }
    });
  }

  private generateHandle(prefix: string): string {
    return prefix
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  // Statistics and reporting
  async getSpeakerStatistics(): Promise<{
    total: number;
    byType: Record<SpeakerType, number>;
    unmatched: number;
    attorneys: number;
    witnesses: number;
  }> {
    const speakers = await this.getAllSpeakersForTrial();
    
    const stats = {
      total: speakers.length,
      byType: {} as Record<SpeakerType, number>,
      unmatched: 0,
      attorneys: 0,
      witnesses: 0
    };
    
    for (const speaker of speakers) {
      const type = speaker.speakerType;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      
      if (type === 'UNKNOWN' || type === 'ANONYMOUS') {
        stats.unmatched++;
      }
      if (type === 'ATTORNEY') {
        stats.attorneys++;
      }
      if (type === 'WITNESS') {
        stats.witnesses++;
      }
    }
    
    return stats;
  }
}