import { Injectable, Logger } from '@nestjs/common';
import { locationConfig } from '../whatsapp-api/whatsapp.config';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface StateOption {
  value: string;
  label: string;
}

export interface DistrictOption {
  value: string;
  label: string;
}

export interface BlockOption {
  value: string;
  label: string;
}

export interface VillageOption {
  value: string;
  label: string;
}

/**
 * Flow Option format - matches WhatsApp Flow JSON {id, title}
 */
export interface FlowOption {
  id: string;
  title: string;
}

// ─────────────────────────────────────────────────────────────
// Cache Types
// ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────
// Location Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  // In-memory cache
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Reviewer backend base URL
  private readonly reviewerBackendUrl: string;

  constructor() {
    this.reviewerBackendUrl = locationConfig.reviewerBackendBaseUrl;
  }

  // ─────────────────────────────────────────────────────────────
  // Public API Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all states for WhatsApp Flow dropdown
   */
  async getStates(): Promise<StateOption[]> {
    const cacheKey = 'states';
    const cached = this.getFromCache<StateOption[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning ${cached.length} states from cache`);
      return cached;
    }

    try {
      const response = await fetch(`${this.reviewerBackendUrl}/api/location/states`);

      if (!response.ok) {
        throw new Error(`Failed to fetch states: ${response.status} ${response.statusText}`);
      }

      const states = await response.json();

      // Transform to Flow dropdown format
      const options: StateOption[] = (states as any[]).map((state) => ({
        value: String(state.stateCode),
        label: state.stateNameEnglish,
      }));

      this.setCache(cacheKey, options);
      this.logger.log(`Fetched and cached ${options.length} states`);

      return options;
    } catch (error) {
      this.logger.error(`Failed to fetch states: ${error}`);
      // Return empty array on error (Flow will show empty dropdown)
      return [];
    }
  }

  /**
   * Get districts for a given state
   */
  async getDistricts(stateCode: number): Promise<DistrictOption[]> {
    const cacheKey = `districts_${stateCode}`;
    const cached = this.getFromCache<DistrictOption[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning ${cached.length} districts for state ${stateCode} from cache`);
      return cached;
    }

    try {
      const response = await fetch(
        `${this.reviewerBackendUrl}/api/location/districts?stateCode=${stateCode}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch districts: ${response.status}`);
      }

      const districts = await response.json();

      const options: DistrictOption[] = (districts as any[]).map((district) => ({
        value: String(district.districtCode),
        label: district.districtNameEnglish,
      }));

      this.setCache(cacheKey, options);
      this.logger.debug(`Fetched and cached ${options.length} districts for state ${stateCode}`);

      return options;
    } catch (error) {
      this.logger.error(`Failed to fetch districts for state ${stateCode}: ${error}`);
      return [];
    }
  }

  /**
   * Get blocks for a given district
   */
  async getBlocks(districtCode: number): Promise<BlockOption[]> {
    const cacheKey = `blocks_${districtCode}`;
    const cached = this.getFromCache<BlockOption[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning ${cached.length} blocks for district ${districtCode} from cache`);
      return cached;
    }

    try {
      const response = await fetch(
        `${this.reviewerBackendUrl}/api/location/blocks?districtCode=${districtCode}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch blocks: ${response.status}`);
      }

      const blocks = await response.json();

      const options: BlockOption[] = (blocks as any[]).map((block) => ({
        value: String(block.blockCode),
        label: block.blockNameEnglish,
      }));

      this.setCache(cacheKey, options);
      this.logger.debug(`Fetched and cached ${options.length} blocks for district ${districtCode}`);

      return options;
    } catch (error) {
      this.logger.error(`Failed to fetch blocks for district ${districtCode}: ${error}`);
      return [];
    }
  }

  /**
   * Get villages for a given block
   */
  async getVillages(blockCode: number): Promise<VillageOption[]> {
    const cacheKey = `villages_${blockCode}`;
    const cached = this.getFromCache<VillageOption[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning ${cached.length} villages for block ${blockCode} from cache`);
      return cached;
    }

    try {
      const response = await fetch(
        `${this.reviewerBackendUrl}/api/location/villages?blockCode=${blockCode}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch villages: ${response.status}`);
      }

      const villages = await response.json();

      const options: VillageOption[] = (villages as any[]).map((village) => ({
        value: String(village.villageCode),
        label: village.villageNameEnglish,
      }));

      this.setCache(cacheKey, options);
      this.logger.debug(`Fetched and cached ${options.length} villages for block ${blockCode}`);

      return options;
    } catch (error) {
      this.logger.error(`Failed to fetch villages for block ${blockCode}: ${error}`);
      return [];
    }
  }

  /**
   * Get single state by code
   */
  async getStateByCode(stateCode: number): Promise<StateOption | null> {
    const states = await this.getStates();
    return states.find((s) => s.value === String(stateCode)) || null;
  }

  /**
   * Get single district by code
   */
  async getDistrictByCode(districtCode: number): Promise<DistrictOption | null> {
    // We need stateCode - fetch from reviewer backend
    // For now, return null (caller should use getDistricts)
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Flow Formatted Methods ({id, title} format)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get states in Flow format {id, title}
   */
  async getStatesFormatted(): Promise<FlowOption[]> {
    const states = await this.getStates();
    return states.map((s) => ({ id: s.value, title: s.label }));
  }

  /**
   * Get districts in Flow format {id, title}
   */
  async getDistrictsFormatted(stateCode: number): Promise<FlowOption[]> {
    const districts = await this.getDistricts(stateCode);
    return districts.map((d) => ({ id: d.value, title: d.label }));
  }

  /**
   * Get blocks in Flow format {id, title}
   */
  async getBlocksFormatted(districtCode: number): Promise<FlowOption[]> {
    const blocks = await this.getBlocks(districtCode);
    return blocks.map((b) => ({ id: b.value, title: b.label }));
  }

  /**
   * Get villages in Flow format {id, title}
   */
  async getVillagesFormatted(blockCode: number): Promise<FlowOption[]> {
    const villages = await this.getVillages(blockCode);
    return villages.map((v) => ({ id: v.value, title: v.label }));
  }

  /**
   * Clear all cache (useful for testing or refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Location cache cleared');
  }

  // ─────────────────────────────────────────────────────────────
  // Cache Helpers
  // ─────────────────────────────────────────────────────────────

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.CACHE_TTL_MS) {
      // Cache expired
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }
}