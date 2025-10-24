/**
 * Solid Pod Data Service
 * Handles reading and writing Redstring data to/from Solid Pods
 */

import {
  getSolidDataset,
  saveSolidDatasetAt,
  createSolidDataset,
  setThing,
  getThing,
  getThingAll,
  createThing,
  addUrl,
  addStringNoLocale,
  getUrl,
  getStringNoLocale,
  overwriteFile,
  getFile
} from '@inrupt/solid-client';

import { solidAuth } from './solidAuth.js';
import { exportToRedstring } from '../formats/redstringFormat.js';

class SolidDataService {
  constructor() {
    this.redstringContainerPath = 'redstring/';
    this.spacesIndexPath = 'redstring/spaces.ttl';
  }

  /**
   * Get the authenticated fetch function
   * @returns {Function} Authenticated fetch
   */
  getAuthenticatedFetch() {
    return solidAuth.getAuthenticatedFetch();
  }

  /**
   * Get the full URL for a resource in the user's Pod
   * @param {string} path - Path relative to Pod root
   * @returns {string} Full URL
   */
  getPodResourceUrl(path) {
    const podUrl = solidAuth.extractPodUrl();
    if (!podUrl) {
      throw new Error('No Pod URL available - user may not be logged in');
    }
    return new URL(path, podUrl).toString();
  }

  /**
   * Ensure the Redstring container exists in the Pod
   * @returns {Promise<void>}
   */
  async ensureRedstringContainer() {
    try {
      const containerUrl = this.getPodResourceUrl(this.redstringContainerPath);
      const fetch = this.getAuthenticatedFetch();
      
      // Try to access the container
      try {
        await getSolidDataset(containerUrl, { fetch });
      } catch (error) {
        if (error.response?.status === 404) {
          // Container doesn't exist, create it
          const emptyDataset = createSolidDataset();
          await saveSolidDatasetAt(containerUrl, emptyDataset, { fetch });
          console.log('[SolidData] Created Redstring container at:', containerUrl);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('[SolidData] Failed to ensure Redstring container:', error);
      throw new Error(`Failed to setup Redstring container: ${error.message}`);
    }
  }

  /**
   * Save a Redstring cognitive space to the Pod
   * @param {Object} storeState - The current Zustand store state
   * @param {string} spaceName - Name for the cognitive space
   * @param {string} [userDomain] - User's domain for dynamic URI generation
   * @returns {Promise<string>} URL of the saved space
   */
  async saveCognitiveSpace(storeState, spaceName, userDomain = null) {
    try {
      await this.ensureRedstringContainer();
      
      const redstringData = exportToRedstring(storeState, userDomain);
      const fileName = `${spaceName.replace(/[^a-zA-Z0-9-_]/g, '_')}.redstring`;
      const spaceUrl = this.getPodResourceUrl(`${this.redstringContainerPath}${fileName}`);
      
      const fetch = this.getAuthenticatedFetch();
      const jsonContent = JSON.stringify(redstringData, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      
      await overwriteFile(spaceUrl, blob, { 
        fetch,
        contentType: 'application/json'
      });

      // Update the spaces index
      await this.updateSpacesIndex(spaceName, spaceUrl, redstringData.metadata);
      
      console.log('[SolidData] Saved cognitive space to:', spaceUrl);
      return spaceUrl;
    } catch (error) {
      console.error('[SolidData] Failed to save cognitive space:', error);
      throw new Error(`Failed to save cognitive space: ${error.message}`);
    }
  }

  /**
   * Load a Redstring cognitive space from the Pod
   * @param {string} spaceUrl - URL of the cognitive space
   * @returns {Promise<Object>} Parsed Redstring data
   */
  async loadCognitiveSpace(spaceUrl) {
    try {
      const fetch = this.getAuthenticatedFetch();
      const file = await getFile(spaceUrl, { fetch });
      const jsonText = await file.text();
      const redstringData = JSON.parse(jsonText);
      
      console.log('[SolidData] Loaded cognitive space from:', spaceUrl);
      return redstringData;
    } catch (error) {
      console.error('[SolidData] Failed to load cognitive space:', error);
      throw new Error(`Failed to load cognitive space: ${error.message}`);
    }
  }

  /**
   * Update the spaces index with information about a cognitive space
   * @param {string} spaceName - Name of the space
   * @param {string} spaceUrl - URL of the space
   * @param {Object} metadata - Space metadata
   * @returns {Promise<void>}
   */
  async updateSpacesIndex(spaceName, spaceUrl, metadata) {
    try {
      const indexUrl = this.getPodResourceUrl(this.spacesIndexPath);
      const fetch = this.getAuthenticatedFetch();
      
      let dataset;
      try {
        dataset = await getSolidDataset(indexUrl, { fetch });
      } catch (error) {
        if (error.response?.status === 404) {
          dataset = createSolidDataset();
        } else {
          throw error;
        }
      }

      // Create or update the space entry
      const spaceThingUrl = `${indexUrl}#${spaceName.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
      let spaceThing = getThing(dataset, spaceThingUrl) || createThing({ url: spaceThingUrl });
      
      spaceThing = addUrl(spaceThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'https://redstring.io/vocab/CognitiveSpace');
      spaceThing = addStringNoLocale(spaceThing, 'http://schema.org/name', spaceName);
      spaceThing = addUrl(spaceThing, 'https://redstring.io/vocab/spaceLocation', spaceUrl);
      
      if (metadata?.title) {
        spaceThing = addStringNoLocale(spaceThing, 'http://schema.org/title', metadata.title);
      }
      if (metadata?.description) {
        spaceThing = addStringNoLocale(spaceThing, 'http://schema.org/description', metadata.description);
      }
      
      spaceThing = addStringNoLocale(spaceThing, 'http://purl.org/dc/terms/modified', new Date().toISOString());

      dataset = setThing(dataset, spaceThing);
      await saveSolidDatasetAt(indexUrl, dataset, { fetch });
      
      console.log('[SolidData] Updated spaces index');
    } catch (error) {
      console.error('[SolidData] Failed to update spaces index:', error);
      // Don't throw here - saving the space itself was successful
    }
  }

  /**
   * List all cognitive spaces in the Pod
   * @returns {Promise<Array>} Array of space information
   */
  async listCognitiveSpaces() {
    try {
      const indexUrl = this.getPodResourceUrl(this.spacesIndexPath);
      const fetch = this.getAuthenticatedFetch();
      
      let dataset;
      try {
        dataset = await getSolidDataset(indexUrl, { fetch });
      } catch (error) {
        if (error.response?.status === 404) {
          return []; // No spaces yet
        }
        throw error;
      }

      const spaceThings = getThingAll(dataset);
      const spaces = [];

      for (const thing of spaceThings) {
        const name = getStringNoLocale(thing, 'http://schema.org/name');
        const spaceUrl = getUrl(thing, 'https://redstring.io/vocab/spaceLocation');
        const title = getStringNoLocale(thing, 'http://schema.org/title');
        const description = getStringNoLocale(thing, 'http://schema.org/description');
        const modified = getStringNoLocale(thing, 'http://purl.org/dc/terms/modified');

        if (name && spaceUrl) {
          spaces.push({
            name,
            spaceUrl,
            title: title || name,
            description: description || '',
            modified: modified ? new Date(modified) : null
          });
        }
      }

      return spaces.sort((a, b) => {
        if (!a.modified && !b.modified) return 0;
        if (!a.modified) return 1;
        if (!b.modified) return -1;
        return b.modified - a.modified; // Most recent first
      });
    } catch (error) {
      console.error('[SolidData] Failed to list cognitive spaces:', error);
      throw new Error(`Failed to list cognitive spaces: ${error.message}`);
    }
  }

  /**
   * Delete a cognitive space from the Pod
   * @param {string} spaceUrl - URL of the space to delete
   * @param {string} spaceName - Name of the space (for index removal)
   * @returns {Promise<void>}
   */
  async deleteCognitiveSpace(spaceUrl, spaceName) {
    try {
      const fetch = this.getAuthenticatedFetch();
      
      // Delete the space file
      await fetch(spaceUrl, { method: 'DELETE' });
      
      // Remove from index
      const indexUrl = this.getPodResourceUrl(this.spacesIndexPath);
      try {
        const dataset = await getSolidDataset(indexUrl, { fetch });
        const spaceThingUrl = `${indexUrl}#${spaceName.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
        const spaceThing = getThing(dataset, spaceThingUrl);
        
        if (spaceThing) {
          // Note: @inrupt/solid-client doesn't have removeThing, so we'd need to rebuild dataset
          console.warn('[SolidData] Space removed from Pod but may still appear in index');
        }
      } catch (indexError) {
        console.warn('[SolidData] Failed to update index after deletion:', indexError);
      }
      
      console.log('[SolidData] Deleted cognitive space:', spaceUrl);
    } catch (error) {
      console.error('[SolidData] Failed to delete cognitive space:', error);
      throw new Error(`Failed to delete cognitive space: ${error.message}`);
    }
  }
}

// Create and export singleton instance
export const solidData = new SolidDataService();
export default solidData; 