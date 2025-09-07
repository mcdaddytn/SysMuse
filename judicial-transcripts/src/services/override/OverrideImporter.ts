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
  WitnessOverride,
  LawFirmOverride,
  LawFirmOfficeOverride,
  AddressOverride,
  JudgeOverride,
  CourtReporterOverride,
  TrialAttorneyOverride,
  MarkerOverride,
  MarkerSectionOverride
} from './types';
// Speaker imports removed - speakers are now created during transcript parsing, not import
import { generateFileToken, generateCaseHandle } from '../../utils/fileTokenGenerator';

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
      Witness: new Map(),
      LawFirm: new Map(),
      LawFirmOffice: new Map(),
      Address: new Map(),
      Judge: new Map(),
      CourtReporter: new Map(),
      Speaker: new Map(),
      Marker: new Map(),
      MarkerSection: new Map()
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
      const trials = Array.isArray(data.Trial) ? data.Trial : [data.Trial];
      trials.forEach((trial, index) => {
        // For Update action, id is required
        if (trial.overrideAction !== 'Insert' && !trial.id) {
          errors.push(`Trial[${index}]: missing id for Update action`);
        }
        if (!trial.name) errors.push(`Trial[${index}]: missing name`);
        if (!trial.caseNumber) errors.push(`Trial[${index}]: missing caseNumber`);
        if (!trial.court) errors.push(`Trial[${index}]: missing court`);
      });
    }

    // Validate Attorney data
    if (data.Attorney) {
      data.Attorney.forEach((attorney, index) => {
        if (attorney.overrideAction !== 'Insert' && !attorney.id) {
          errors.push(`Attorney[${index}]: missing id for Update action`);
        }
        if (!attorney.name) errors.push(`Attorney[${index}]: missing name`);
      });
    }

    // Validate Witness data
    if (data.Witness) {
      data.Witness.forEach((witness, index) => {
        if (witness.overrideAction !== 'Insert' && !witness.id && !witness.name) {
          errors.push(`Witness[${index}]: missing id or name for Update action`);
        }
        if (!witness.name) errors.push(`Witness[${index}]: missing name`);
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
        
        const trials = data.Trial ? (Array.isArray(data.Trial) ? data.Trial : [data.Trial]) : [];
        if (trials.length > 0 && !trials.find((t: TrialOverride) => t.id === ta.trialId)) {
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
        if (data.Trial) {
          const trials = Array.isArray(data.Trial) ? data.Trial : [data.Trial];
          if (trials.length > 0) {
            result.imported.trials = await this.importTrials(tx, trials);
          }
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

        // 9. Import Witnesses (needs speaker creation)
        if (data.Witness && data.Witness.length > 0) {
          result.imported.witnesses = await this.importWitnesses(tx, data.Witness);
        }

        // 10. Import Markers
        if (data.Marker && data.Marker.length > 0) {
          result.imported.markers = await this.importMarkers(tx, data.Marker);
        }

        // 11. Import MarkerSections (depends on Marker)
        if (data.MarkerSection && data.MarkerSection.length > 0) {
          result.imported.markerSections = await this.importMarkerSections(tx, data.MarkerSection);
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
      if (address.id) {
        this.correlationMap.Address.set(address.id, created.id);
      }
      count++;
    }
    return count;
  }

  private async importTrials(tx: any, trials: TrialOverride[]): Promise<number> {
    let count = 0;
    for (const trial of trials) {
      const action = (trial.overrideAction || 'Upsert').toLowerCase();
      
      // Generate shortNameHandle from shortName if not provided
      const shortNameHandle = trial.shortNameHandle || 
        (trial.shortName ? generateFileToken(trial.shortName) : null);
      
      // ALWAYS derive caseHandle from caseNumber, never trust override data
      const caseHandle = generateCaseHandle(trial.caseNumber);
      
      if (action === 'insert') {
        // Create new trial
        const created = await tx.trial.create({
          data: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseNumber: trial.caseNumber,
            caseHandle, // Use derived value, not from override
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
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, created.id);
        }
        count++;
      } else if (action === 'upsert') {
        // Upsert based on caseNumber
        const upserted = await tx.trial.upsert({
          where: { caseNumber: trial.caseNumber },
          create: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseNumber: trial.caseNumber,
            caseHandle, // Use derived value, not from override
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            alternateCaseNumber: trial.alternateCaseNumber,
            alternateDefendant: trial.alternateDefendant,
            court: trial.court,
            courtDivision: trial.courtDivision,
            courtDistrict: trial.courtDistrict,
            totalPages: trial.totalPages
          },
          update: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseHandle, // Use derived value, not from override
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
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, upserted.id);
        }
        count++;
      } else {
        // Update existing trial
        let updated;
        if (typeof trial.id === 'number') {
          // Update by ID
          updated = await tx.trial.update({
            where: { id: trial.id },
            data: {
              name: trial.name,
              shortName: trial.shortName,
              shortNameHandle,
              caseHandle, // Use derived value, not from override
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
        } else {
          // Update by caseNumber as unique key
          updated = await tx.trial.update({
            where: { caseNumber: trial.caseNumber },
            data: {
              name: trial.name,
              shortName: trial.shortName,
              shortNameHandle,
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
        }
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, updated.id);
        }
        count++;
      }
    }
    return count;
  }

  private async importLawFirms(tx: any, firms: LawFirmOverride[]): Promise<number> {
    let count = 0;
    for (const firm of firms) {
      const action = firm.overrideAction || 'Upsert';
      const overrideKey = firm.overrideKey || 'id';
      
      let existingFirm = null;
      
      // Find existing firm based on override key
      if (action === 'Update' || action === 'Upsert') {
        if (overrideKey === 'id' && firm.id) {
          existingFirm = await tx.lawFirm.findUnique({
            where: { id: Number(firm.id) }
          });
        } else if (overrideKey === 'lawFirmFingerprint' && firm.lawFirmFingerprint) {
          existingFirm = await tx.lawFirm.findFirst({
            where: { lawFirmFingerprint: firm.lawFirmFingerprint }
          });
        }
      }
      
      if (action === 'Insert' && existingFirm) {
        throw new Error(`LawFirm already exists with ${overrideKey}: ${firm[overrideKey as keyof LawFirmOverride]}`);
      }
      
      if (action === 'Update' && !existingFirm) {
        throw new Error(`LawFirm not found with ${overrideKey}: ${firm[overrideKey as keyof LawFirmOverride]}`);
      }
      
      let created;
      if (existingFirm) {
        // Update existing firm
        created = await tx.lawFirm.update({
          where: { id: existingFirm.id },
          data: {
            name: firm.name,
            lawFirmFingerprint: firm.lawFirmFingerprint
          }
        });
      } else {
        // Create new firm
        created = await tx.lawFirm.create({
          data: {
            name: firm.name,
            lawFirmFingerprint: firm.lawFirmFingerprint
          }
        });
      }
      
      this.correlationMap.LawFirm.set(firm.id || created.id, created.id);
      count++;
    }
    return count;
  }

  private async importLawFirmOffices(tx: any, offices: LawFirmOfficeOverride[]): Promise<number> {
    let count = 0;
    for (const office of offices) {
      const action = office.overrideAction || 'Upsert';
      const overrideKey = office.overrideKey || 'id';
      
      const lawFirmId = this.correlationMap.LawFirm.get(office.lawFirmId);
      if (!lawFirmId) {
        throw new Error(`LawFirm not found for office: ${office.id}`);
      }

      const addressId = office.addressId ? 
        this.correlationMap.Address.get(office.addressId) : undefined;
      
      let existingOffice = null;
      
      // Find existing office based on override key
      if (action === 'Update' || action === 'Upsert') {
        if (overrideKey === 'id' && office.id) {
          existingOffice = await tx.lawFirmOffice.findUnique({
            where: { id: Number(office.id) }
          });
        } else if (overrideKey === 'lawFirmOfficeFingerprint' && office.lawFirmOfficeFingerprint) {
          existingOffice = await tx.lawFirmOffice.findFirst({
            where: { lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint }
          });
        }
      }
      
      if (action === 'Insert' && existingOffice) {
        throw new Error(`LawFirmOffice already exists with ${overrideKey}: ${office[overrideKey as keyof LawFirmOfficeOverride]}`);
      }
      
      if (action === 'Update' && !existingOffice) {
        throw new Error(`LawFirmOffice not found with ${overrideKey}: ${office[overrideKey as keyof LawFirmOfficeOverride]}`);
      }
      
      let created;
      if (existingOffice) {
        // Update existing office
        created = await tx.lawFirmOffice.update({
          where: { id: existingOffice.id },
          data: {
            lawFirmId,
            name: office.name,
            addressId,
            lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
          }
        });
      } else {
        // Check if office already exists with same lawFirmId and name
        const existingByName = await tx.lawFirmOffice.findFirst({
          where: {
            lawFirmId,
            name: office.name
          }
        });
        
        if (existingByName) {
          // Update the existing office instead of creating a duplicate
          created = await tx.lawFirmOffice.update({
            where: { id: existingByName.id },
            data: {
              addressId,
              lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
            }
          });
        } else {
          // Create new office
          created = await tx.lawFirmOffice.create({
            data: {
              lawFirmId,
              name: office.name,
              addressId,
              lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
            }
          });
        }
      }
      
      this.correlationMap.LawFirmOffice.set(office.id || created.id, created.id);
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
      const action = attorney.overrideAction || 'Upsert';
      const overrideKey = attorney.overrideKey || 'id';
      
      // Generate attorney fingerprint (use provided or generate)
      const fingerprint = attorney.attorneyFingerprint || this.generateAttorneyFingerprint(attorney);
      
      let existingAttorney = null;
      
      // Find existing attorney based on override key
      if (action === 'Update' || action === 'Upsert') {
        if (overrideKey === 'id' && attorney.id) {
          existingAttorney = await tx.attorney.findUnique({
            where: { id: Number(attorney.id) },
            include: { speaker: true }
          });
        } else if (overrideKey === 'attorneyFingerprint' && fingerprint) {
          existingAttorney = await tx.attorney.findFirst({
            where: { attorneyFingerprint: fingerprint },
            include: { speaker: true }
          });
        }
      }
      
      if (action === 'Insert' && existingAttorney) {
        throw new Error(`Attorney already exists with ${overrideKey}: ${attorney[overrideKey as keyof AttorneyOverride]}`);
      }
      
      if (action === 'Update' && !existingAttorney) {
        throw new Error(`Attorney not found with ${overrideKey}: ${attorney[overrideKey as keyof AttorneyOverride]}`);
      }
      
      let created;
      
      if (existingAttorney) {
        // Update existing attorney
        // Update attorney
        created = await tx.attorney.update({
          where: { id: existingAttorney.id },
          data: {
            name: attorney.name,
            title: attorney.title,
            firstName: attorney.firstName,
            middleInitial: attorney.middleInitial,
            lastName: attorney.lastName,
            suffix: attorney.suffix,
            speakerPrefix: attorney.speakerPrefix,
            barNumber: attorney.barNumber,
            attorneyFingerprint: fingerprint
          }
        });
      } else {
        // Create new attorney (without speaker - speakers are created during parsing)
        created = await tx.attorney.create({
          data: {
            name: attorney.name,
            title: attorney.title,
            firstName: attorney.firstName,
            middleInitial: attorney.middleInitial,
            lastName: attorney.lastName,
            suffix: attorney.suffix,
            speakerPrefix: attorney.speakerPrefix,
            barNumber: attorney.barNumber,
            attorneyFingerprint: fingerprint
            // Note: speakerId removed - speakers are created during transcript parsing
          }
        });
      }
      
      this.correlationMap.Attorney.set(attorney.id || created.id, created.id);
      // Note: Speaker correlation removed - speakers are created during parsing
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

      // Create judge (without speaker - speakers are created during parsing)
      const created = await tx.judge.create({
        data: {
          name: judge.name,
          title: judge.title,
          honorific: judge.honorific,
          // Note: speakerId removed - speakers are created during transcript parsing
          trialId
        }
      });
      if (judge.id) {
        this.correlationMap.Judge.set(judge.id, created.id);
      }
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

      // First check if a court reporter already exists for this trial
      const existing = await tx.courtReporter.findUnique({
        where: { trialId }
      });

      let created;
      if (existing) {
        // Update existing court reporter
        created = await tx.courtReporter.update({
          where: { trialId },
          data: {
            name: reporter.name,
            credentials: reporter.credentials,
            title: reporter.title,
            stateNumber: reporter.stateNumber,
            expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
            addressId,
            phone: reporter.phone,
            courtReporterFingerprint: reporter.courtReporterFingerprint
          }
        });
      } else {
        // Create new court reporter
        created = await tx.courtReporter.create({
          data: {
            name: reporter.name,
            credentials: reporter.credentials,
            title: reporter.title,
            stateNumber: reporter.stateNumber,
            expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
            addressId,
            phone: reporter.phone,
            trialId,
            courtReporterFingerprint: reporter.courtReporterFingerprint
          }
        });
      }
      if (reporter.id) {
        this.correlationMap.CourtReporter.set(reporter.id, created.id);
      }
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

  private async importWitnesses(tx: any, witnesses: WitnessOverride[]): Promise<number> {
    let count = 0;
    
    // Get the first trial from our correlation map for speaker creation
    const trialIds = Array.from(this.correlationMap.Trial.values());
    if (trialIds.length === 0) {
      throw new Error('No trial found to associate witnesses with. Import trials first.');
    }
    const trialId = trialIds[0];
    
    for (const witness of witnesses) {
      const action = witness.overrideAction || 'Upsert';
      
      if (action === 'Insert') {
        // Create new witness (without speaker - speakers are created during parsing)
        const created = await tx.witness.create({
          data: {
            trialId: witness.trialId ? this.correlationMap.Trial.get(witness.trialId) || trialId : trialId,
            name: witness.name,
            witnessType: witness.witnessType || 'UNKNOWN',
            witnessCaller: witness.witnessCaller || 'UNKNOWN',
            expertField: witness.expertField
            // Note: speakerId removed - speakers are created during transcript parsing
          }
        });
        
        if (witness.id) {
          this.correlationMap.Witness.set(witness.id, created.id);
        }
        count++;
      } else {
        // Update existing witness by name (as unique key within trial)
        const existingWitness = await tx.witness.findFirst({
          where: {
            trialId: witness.trialId ? this.correlationMap.Trial.get(witness.trialId) || trialId : trialId,
            name: witness.name
          }
        });
        
        if (existingWitness) {
          await tx.witness.update({
            where: { id: existingWitness.id },
            data: {
              witnessType: witness.witnessType || existingWitness.witnessType,
              witnessCaller: witness.witnessCaller || existingWitness.witnessCaller,
              expertField: witness.expertField !== undefined ? witness.expertField : existingWitness.expertField
            }
          });
          
          if (witness.id) {
            this.correlationMap.Witness.set(witness.id, existingWitness.id);
          }
          count++;
        }
      }
    }
    return count;
  }

  private async importMarkers(tx: any, markers: MarkerOverride[]): Promise<number> {
    let count = 0;
    
    for (const marker of markers) {
      const action = marker.overrideAction || 'Upsert';
      const trialId = marker.trialId ? this.correlationMap.Trial.get(marker.trialId) : null;
      
      if (!trialId) {
        throw new Error(`Trial not found for marker: ${marker.name}`);
      }
      
      if (action === 'Insert') {
        // Create new marker
        const created = await tx.marker.create({
          data: {
            trialId,
            name: marker.name,
            markerType: marker.markerType || 'CUSTOM',
            startLineId: marker.startLineId ? Number(marker.startLineId) : null,
            endLineId: marker.endLineId ? Number(marker.endLineId) : null,
            metadata: marker.metadata || {}
          }
        });
        
        if (marker.id) {
          this.correlationMap.Marker.set(marker.id, created.id);
        }
        count++;
      } else {
        // Update existing marker - would need unique identifier
        // For now, skip updates as markers don't have a natural unique key
        console.warn(`Marker updates not yet supported for: ${marker.name}`);
      }
    }
    return count;
  }

  private async importMarkerSections(tx: any, sections: MarkerSectionOverride[]): Promise<number> {
    let count = 0;
    
    for (const section of sections) {
      const action = section.overrideAction || 'Upsert';
      const markerId = this.correlationMap.Marker.get(section.markerId);
      
      if (!markerId) {
        throw new Error(`Marker not found for section: ${section.sectionName}`);
      }
      
      if (action === 'Insert') {
        // Create new marker section
        const created = await tx.markerSection.create({
          data: {
            markerId,
            sectionName: section.sectionName,
            startLineId: section.startLineId ? Number(section.startLineId) : null,
            endLineId: section.endLineId ? Number(section.endLineId) : null,
            orderIndex: section.orderIndex || 0
          }
        });
        
        if (section.id) {
          this.correlationMap.MarkerSection.set(section.id, created.id);
        }
        count++;
      } else {
        // Update existing marker section - would need unique identifier
        console.warn(`MarkerSection updates not yet supported for: ${section.sectionName}`);
      }
    }
    return count;
  }

  getCorrelationMap(): CorrelationMap {
    return this.correlationMap;
  }
}