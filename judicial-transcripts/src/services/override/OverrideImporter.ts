import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  OverrideData,
  CorrelationMap,
  ImportResult,
  ValidationResult,
  TrialOverride,
  AttorneyOverride,
  LawFirmOverride,
  LawFirmOfficeOverride,
  AddressOverride,
  JudgeOverride,
  CourtReporterOverride,
  TrialAttorneyOverride
} from './types';
import { createOrFindSpeaker } from '../speakers/speakerService';
import { generateSpeakerHandle, generateSpeakerPrefix } from '../speakers/speakerUtils';

export class OverrideImporter {
  private prisma: PrismaClient;
  private correlationMap: CorrelationMap;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.correlationMap = this.initializeCorrelationMap();
  }

  private initializeCorrelationMap(): CorrelationMap {
    return {
      Trial: new Map(),
      Attorney: new Map(),
      LawFirm: new Map(),
      LawFirmOffice: new Map(),
      Address: new Map(),
      Judge: new Map(),
      CourtReporter: new Map(),
      Speaker: new Map()
    };
  }

  async loadOverrideFile(filePath: string): Promise<OverrideData> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Override file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    try {
      return JSON.parse(content) as OverrideData;
    } catch (error) {
      throw new Error(`Invalid JSON in override file: ${error}`);
    }
  }

  validateOverrides(data: OverrideData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate Trial data
    if (data.Trial) {
      data.Trial.forEach((trial, index) => {
        if (!trial.id) errors.push(`Trial[${index}]: missing id`);
        if (!trial.name) errors.push(`Trial[${index}]: missing name`);
        if (!trial.caseNumber) errors.push(`Trial[${index}]: missing caseNumber`);
        if (!trial.court) errors.push(`Trial[${index}]: missing court`);
      });
    }

    // Validate Attorney data
    if (data.Attorney) {
      data.Attorney.forEach((attorney, index) => {
        if (!attorney.id) errors.push(`Attorney[${index}]: missing id`);
        if (!attorney.name) errors.push(`Attorney[${index}]: missing name`);
      });
    }

    // Validate LawFirm data
    if (data.LawFirm) {
      data.LawFirm.forEach((firm, index) => {
        if (!firm.id) errors.push(`LawFirm[${index}]: missing id`);
        if (!firm.name) errors.push(`LawFirm[${index}]: missing name`);
      });
    }

    // Validate relationships
    if (data.LawFirmOffice) {
      data.LawFirmOffice.forEach((office, index) => {
        if (!office.lawFirmId) {
          errors.push(`LawFirmOffice[${index}]: missing lawFirmId`);
        } else if (data.LawFirm && !data.LawFirm.find(f => f.id === office.lawFirmId)) {
          warnings.push(`LawFirmOffice[${index}]: references non-existent LawFirm ${office.lawFirmId}`);
        }
        
        if (office.addressId && data.Address && !data.Address.find(a => a.id === office.addressId)) {
          warnings.push(`LawFirmOffice[${index}]: references non-existent Address ${office.addressId}`);
        }
      });
    }

    if (data.TrialAttorney) {
      data.TrialAttorney.forEach((ta, index) => {
        if (!ta.trialId) errors.push(`TrialAttorney[${index}]: missing trialId`);
        if (!ta.attorneyId) errors.push(`TrialAttorney[${index}]: missing attorneyId`);
        
        if (data.Trial && !data.Trial.find(t => t.id === ta.trialId)) {
          warnings.push(`TrialAttorney[${index}]: references non-existent Trial ${ta.trialId}`);
        }
        if (data.Attorney && !data.Attorney.find(a => a.id === ta.attorneyId)) {
          warnings.push(`TrialAttorney[${index}]: references non-existent Attorney ${ta.attorneyId}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async applyOverrides(data: OverrideData): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      imported: {},
      errors: []
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        // Import in dependency order
        
        // 1. Import Addresses first (no dependencies)
        if (data.Address && data.Address.length > 0) {
          result.imported.addresses = await this.importAddresses(tx, data.Address);
        }

        // 2. Import Trials (no dependencies on other override entities)
        if (data.Trial && data.Trial.length > 0) {
          result.imported.trials = await this.importTrials(tx, data.Trial);
        }

        // 3. Import LawFirms (no dependencies)
        if (data.LawFirm && data.LawFirm.length > 0) {
          result.imported.lawFirms = await this.importLawFirms(tx, data.LawFirm);
        }

        // 4. Import LawFirmOffices (depends on LawFirm and Address)
        if (data.LawFirmOffice && data.LawFirmOffice.length > 0) {
          result.imported.lawFirmOffices = await this.importLawFirmOffices(tx, data.LawFirmOffice);
        }

        // 5. Import Attorneys (needs speaker creation)
        if (data.Attorney && data.Attorney.length > 0) {
          result.imported.attorneys = await this.importAttorneys(tx, data.Attorney);
        }

        // 6. Import Judges (depends on Trial and Speaker)
        if (data.Judge && data.Judge.length > 0) {
          result.imported.judges = await this.importJudges(tx, data.Judge);
        }

        // 7. Import CourtReporters (depends on Trial and Address)
        if (data.CourtReporter && data.CourtReporter.length > 0) {
          result.imported.courtReporters = await this.importCourtReporters(tx, data.CourtReporter);
        }

        // 8. Import TrialAttorneys (depends on Trial, Attorney, LawFirm, LawFirmOffice)
        if (data.TrialAttorney && data.TrialAttorney.length > 0) {
          result.imported.trialAttorneys = await this.importTrialAttorneys(tx, data.TrialAttorney);
        }
      });

      result.success = true;
      result.correlationMap = this.correlationMap;
    } catch (error) {
      result.success = false;
      result.errors?.push(`Transaction failed: ${error}`);
    }

    return result;
  }

  private async importAddresses(tx: any, addresses: AddressOverride[]): Promise<number> {
    let count = 0;
    for (const address of addresses) {
      const created = await tx.address.create({
        data: {
          street1: address.street1,
          street2: address.street2,
          city: address.city,
          state: address.state,
          zipCode: address.zipCode,
          country: address.country || 'USA',
          fullAddress: address.fullAddress
        }
      });
      this.correlationMap.Address.set(address.id, created.id);
      count++;
    }
    return count;
  }

  private async importTrials(tx: any, trials: TrialOverride[]): Promise<number> {
    let count = 0;
    for (const trial of trials) {
      const created = await tx.trial.create({
        data: {
          name: trial.name,
          shortName: trial.shortName,
          caseNumber: trial.caseNumber,
          caseHandle: trial.caseHandle,
          plaintiff: trial.plaintiff,
          defendant: trial.defendant,
          alternateCaseNumber: trial.alternateCaseNumber,
          alternateDefendant: trial.alternateDefendant,
          court: trial.court,
          courtDivision: trial.courtDivision,
          courtDistrict: trial.courtDistrict,
          totalPages: trial.totalPages
        }
      });
      this.correlationMap.Trial.set(trial.id, created.id);
      count++;
    }
    return count;
  }

  private async importLawFirms(tx: any, firms: LawFirmOverride[]): Promise<number> {
    let count = 0;
    for (const firm of firms) {
      const created = await tx.lawFirm.create({
        data: {
          name: firm.name
        }
      });
      this.correlationMap.LawFirm.set(firm.id, created.id);
      count++;
    }
    return count;
  }

  private async importLawFirmOffices(tx: any, offices: LawFirmOfficeOverride[]): Promise<number> {
    let count = 0;
    for (const office of offices) {
      const lawFirmId = this.correlationMap.LawFirm.get(office.lawFirmId);
      if (!lawFirmId) {
        throw new Error(`LawFirm not found for office: ${office.id}`);
      }

      const addressId = office.addressId ? 
        this.correlationMap.Address.get(office.addressId) : undefined;

      const created = await tx.lawFirmOffice.create({
        data: {
          lawFirmId,
          name: office.name,
          addressId
        }
      });
      this.correlationMap.LawFirmOffice.set(office.id, created.id);
      count++;
    }
    return count;
  }

  private async importAttorneys(tx: any, attorneys: AttorneyOverride[]): Promise<number> {
    let count = 0;
    
    // We need a trial ID for creating speakers
    // Get the first trial from our correlation map
    const trialIds = Array.from(this.correlationMap.Trial.values());
    if (trialIds.length === 0) {
      throw new Error('No trial found to associate attorneys with. Import trials first.');
    }
    const trialId = trialIds[0];
    
    for (const attorney of attorneys) {
      // Generate consistent speaker handle that will match during parsing
      const speakerHandle = generateSpeakerHandle(attorney.name);
      const speakerPrefix = generateSpeakerPrefix(attorney.name, attorney.speakerPrefix || undefined);
      
      // Create a placeholder speaker for this attorney
      // This will be matched during transcript parsing by the speakerHandle
      const speaker = await tx.speaker.create({
        data: {
          trialId,
          speakerHandle,
          speakerPrefix,
          speakerType: 'ATTORNEY',
          isGeneric: false
        }
      });
      
      // Generate attorney fingerprint for cross-trial matching
      const fingerprint = this.generateAttorneyFingerprint(attorney);
      
      const created = await tx.attorney.create({
        data: {
          name: attorney.name,
          title: attorney.title,
          firstName: attorney.firstName,
          middleInitial: attorney.middleInitial,
          lastName: attorney.lastName,
          suffix: attorney.suffix,
          speakerPrefix: attorney.speakerPrefix,
          barNumber: attorney.barNumber,
          attorneyFingerprint: fingerprint,
          speakerId: speaker.id
        }
      });
      
      this.correlationMap.Attorney.set(attorney.id, created.id);
      this.correlationMap.Speaker.set(attorney.speakerId || attorney.id, speaker.id);
      count++;
    }
    return count;
  }
  
  private generateAttorneyFingerprint(attorney: AttorneyOverride): string {
    // Generate a consistent fingerprint for attorney matching
    // This can be used to identify the same attorney across different trials
    const parts = [
      attorney.lastName?.toUpperCase(),
      attorney.firstName?.toUpperCase(),
      attorney.middleInitial?.toUpperCase(),
      attorney.suffix?.toUpperCase()
    ].filter(Boolean);
    return parts.join('_');
  }

  private async importJudges(tx: any, judges: JudgeOverride[]): Promise<number> {
    let count = 0;
    for (const judge of judges) {
      const trialId = judge.trialId ? 
        this.correlationMap.Trial.get(judge.trialId) : undefined;
      
      if (!trialId) {
        throw new Error(`Trial not found for judge: ${judge.name}`);
      }

      // Generate consistent speaker handle for the judge
      const speakerHandle = generateSpeakerHandle(judge.honorific || 'THE COURT');
      const speakerPrefix = judge.honorific || 'THE COURT';
      
      // Create speaker for judge
      const speaker = await tx.speaker.create({
        data: {
          trialId,
          speakerHandle,
          speakerPrefix,
          speakerType: 'JUDGE',
          isGeneric: false
        }
      });

      const created = await tx.judge.create({
        data: {
          name: judge.name,
          title: judge.title,
          honorific: judge.honorific,
          speakerId: speaker.id,
          trialId
        }
      });
      this.correlationMap.Judge.set(judge.id, created.id);
      count++;
    }
    return count;
  }

  private async importCourtReporters(tx: any, reporters: CourtReporterOverride[]): Promise<number> {
    let count = 0;
    for (const reporter of reporters) {
      const trialId = reporter.trialId ? 
        this.correlationMap.Trial.get(reporter.trialId) : undefined;
      
      if (!trialId) {
        throw new Error(`Trial not found for court reporter: ${reporter.name}`);
      }

      const addressId = reporter.addressId ? 
        this.correlationMap.Address.get(reporter.addressId) : undefined;

      const created = await tx.courtReporter.create({
        data: {
          name: reporter.name,
          credentials: reporter.credentials,
          title: reporter.title,
          stateNumber: reporter.stateNumber,
          expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
          addressId,
          phone: reporter.phone,
          trialId
        }
      });
      this.correlationMap.CourtReporter.set(reporter.id, created.id);
      count++;
    }
    return count;
  }

  private async importTrialAttorneys(tx: any, trialAttorneys: TrialAttorneyOverride[]): Promise<number> {
    let count = 0;
    for (const ta of trialAttorneys) {
      const trialId = this.correlationMap.Trial.get(ta.trialId);
      const attorneyId = this.correlationMap.Attorney.get(ta.attorneyId);
      const lawFirmId = ta.lawFirmId ? 
        this.correlationMap.LawFirm.get(ta.lawFirmId) : undefined;
      const lawFirmOfficeId = ta.lawFirmOfficeId ? 
        this.correlationMap.LawFirmOffice.get(ta.lawFirmOfficeId) : undefined;

      if (!trialId || !attorneyId) {
        throw new Error(`Missing required IDs for TrialAttorney: trial=${ta.trialId}, attorney=${ta.attorneyId}`);
      }

      await tx.trialAttorney.create({
        data: {
          trialId,
          attorneyId,
          lawFirmId,
          lawFirmOfficeId,
          role: ta.role || 'UNKNOWN'
        }
      });
      count++;
    }
    return count;
  }

  getCorrelationMap(): CorrelationMap {
    return this.correlationMap;
  }
}