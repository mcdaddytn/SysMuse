import { PrismaClient } from '@prisma/client';
import { AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class AddressService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Generate full address string from components
   */
  private generateFullAddress(address: AddressInfo): string {
    const parts: string[] = [];
    
    if (address.street1) parts.push(address.street1);
    if (address.street2) parts.push(address.street2);
    
    const cityStateZip: string[] = [];
    if (address.city) cityStateZip.push(address.city);
    if (address.state) cityStateZip.push(address.state);
    if (address.zipCode) cityStateZip.push(address.zipCode);
    
    if (cityStateZip.length > 0) {
      parts.push(cityStateZip.join(', '));
    }
    
    if (address.country && address.country !== 'USA') {
      parts.push(address.country);
    }
    
    return parts.join(', ');
  }

  /**
   * Create or find address based on fullAddress
   */
  async createOrFindAddress(addressInfo: AddressInfo | undefined): Promise<number | null> {
    if (!addressInfo || (!addressInfo.street1 && !addressInfo.city)) {
      return null;
    }

    try {
      // Generate full address for comparison
      const fullAddress = this.generateFullAddress(addressInfo);
      
      // Try to find existing address by fullAddress
      const existingAddress = await this.prisma.address.findFirst({
        where: {
          fullAddress: fullAddress
        }
      });

      if (existingAddress) {
        logger.debug(`Found existing address: ${fullAddress}`);
        return existingAddress.id;
      }

      // Create new address
      const newAddress = await this.prisma.address.create({
        data: {
          street1: addressInfo.street1,
          street2: addressInfo.street2,
          city: addressInfo.city,
          state: addressInfo.state,
          zipCode: addressInfo.zipCode,
          country: addressInfo.country || 'USA',
          fullAddress: fullAddress
        }
      });

      logger.info(`Created new address: ${fullAddress}`);
      return newAddress.id;
    } catch (error) {
      logger.error('Error creating/finding address:', error);
      return null;
    }
  }

  /**
   * Update existing address to add fullAddress field
   */
  async updateAddressWithFullAddress(addressId: number): Promise<void> {
    try {
      const address = await this.prisma.address.findUnique({
        where: { id: addressId }
      });

      if (!address || address.fullAddress) {
        return; // Already has fullAddress or doesn't exist
      }

      const fullAddress = this.generateFullAddress({
        street1: address.street1 || undefined,
        street2: address.street2 || undefined,
        city: address.city || undefined,
        state: address.state || undefined,
        zipCode: address.zipCode || undefined,
        country: address.country || undefined
      });

      await this.prisma.address.update({
        where: { id: addressId },
        data: { fullAddress }
      });

      logger.debug(`Updated address ${addressId} with fullAddress: ${fullAddress}`);
    } catch (error) {
      logger.error(`Error updating address ${addressId}:`, error);
    }
  }

  /**
   * Batch update all addresses to add fullAddress field
   */
  async updateAllAddressesWithFullAddress(): Promise<void> {
    try {
      const addresses = await this.prisma.address.findMany({
        where: {
          fullAddress: null
        }
      });

      logger.info(`Updating ${addresses.length} addresses with fullAddress field`);

      for (const address of addresses) {
        await this.updateAddressWithFullAddress(address.id);
      }

      logger.info('Completed updating addresses with fullAddress field');
    } catch (error) {
      logger.error('Error updating addresses:', error);
    }
  }
}