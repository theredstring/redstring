/**
 * Domain Verification Service
 * Handles domain ownership verification without email requirements
 * Supports DNS, file-based, and meta tag verification methods
 */

class DomainVerificationService {
  constructor() {
    this.verificationMethods = {
      dns: 'dns',
      file: 'file',
      meta: 'meta'
    };
  }

  /**
   * Verify domain ownership using multiple methods
   * @param {string} domain - The domain to verify (e.g., "alice.com")
   * @param {string} method - Verification method: 'dns', 'file', or 'meta'
   * @returns {Promise<boolean>} True if domain is verified
   */
  async verifyDomainOwnership(domain, method = 'dns') {
    try {
      const normalizedDomain = this.normalizeDomain(domain);
      
      switch (method) {
        case this.verificationMethods.dns:
          return await this.verifyViaDNS(normalizedDomain);
        case this.verificationMethods.file:
          return await this.verifyViaFile(normalizedDomain);
        case this.verificationMethods.meta:
          return await this.verifyViaMetaTag(normalizedDomain);
        default:
          throw new Error(`Unknown verification method: ${method}`);
      }
    } catch (error) {
      console.error('[DomainVerification] Verification failed:', error);
      return false;
    }
  }

  /**
   * Normalize domain name
   * @param {string} domain - Raw domain input
   * @returns {string} Normalized domain
   */
  normalizeDomain(domain) {
    // Remove protocol if present
    let normalized = domain.replace(/^https?:\/\//, '');
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    // Remove www. prefix
    normalized = normalized.replace(/^www\./, '');
    return normalized.toLowerCase();
  }

  /**
   * Verify domain ownership via DNS record
   * @param {string} domain - Domain to verify
   * @returns {Promise<boolean>} True if DNS record exists
   */
  async verifyViaDNS(domain) {
    try {
      // Check for TXT record: redstring-verification=verified
      const response = await fetch(`https://dns.google/resolve?name=${domain}&type=TXT`);
      const data = await response.json();
      
      if (data.Answer) {
        for (const answer of data.Answer) {
          const txtRecord = answer.data.replace(/"/g, '');
          if (txtRecord === 'redstring-verification=verified') {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('[DomainVerification] DNS verification failed:', error);
      return false;
    }
  }

  /**
   * Verify domain ownership via file upload
   * @param {string} domain - Domain to verify
   * @returns {Promise<boolean>} True if verification file exists
   */
  async verifyViaFile(domain) {
    try {
      const verificationUrl = `https://${domain}/.well-known/redstring-verification`;
      const response = await fetch(verificationUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain'
        }
      });
      
      if (response.ok) {
        const content = await response.text();
        return content.trim() === 'verified';
      }
      
      return false;
    } catch (error) {
      console.error('[DomainVerification] File verification failed:', error);
      return false;
    }
  }

  /**
   * Verify domain ownership via meta tag
   * @param {string} domain - Domain to verify
   * @returns {Promise<boolean>} True if meta tag exists
   */
  async verifyViaMetaTag(domain) {
    try {
      const response = await fetch(`https://${domain}`, {
        method: 'GET',
        headers: {
          'Accept': 'text/html'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        const metaTagRegex = /<meta\s+name="redstring-verification"\s+content="verified"\s*\/?>/i;
        return metaTagRegex.test(html);
      }
      
      return false;
    } catch (error) {
      console.error('[DomainVerification] Meta tag verification failed:', error);
      return false;
    }
  }

  /**
   * Generate verification instructions for a domain
   * @param {string} domain - Domain to generate instructions for
   * @param {string} method - Verification method
   * @returns {Object} Instructions object
   */
  generateVerificationInstructions(domain, method = 'dns') {
    const normalizedDomain = this.normalizeDomain(domain);
    
    switch (method) {
      case this.verificationMethods.dns:
        return {
          method: 'DNS Record',
          instructions: [
            'Add a TXT record to your domain:',
            `Name: ${normalizedDomain}`,
            'Value: redstring-verification=verified',
            '',
            'This may take up to 24 hours to propagate.'
          ],
          example: `dig TXT ${normalizedDomain}`
        };
        
      case this.verificationMethods.file:
        return {
          method: 'File Upload',
          instructions: [
            'Create a file at this location on your web server:',
            `/.well-known/redstring-verification`,
            '',
            'The file should contain only the text:',
            'verified',
            '',
            'Make sure the file is accessible via HTTPS.'
          ],
          example: `curl https://${normalizedDomain}/.well-known/redstring-verification`
        };
        
      case this.verificationMethods.meta:
        return {
          method: 'Meta Tag',
          instructions: [
            'Add this meta tag to the <head> section of your website:',
            '<meta name="redstring-verification" content="verified">',
            '',
            'Make sure your website is accessible via HTTPS.'
          ],
          example: `<meta name="redstring-verification" content="verified">`
        };
        
      default:
        throw new Error(`Unknown verification method: ${method}`);
    }
  }

  /**
   * Check if a domain is accessible
   * @param {string} domain - Domain to check
   * @returns {Promise<boolean>} True if domain is accessible
   */
  async checkDomainAccessibility(domain) {
    try {
      const normalizedDomain = this.normalizeDomain(domain);
      const response = await fetch(`https://${normalizedDomain}`, {
        method: 'HEAD',
        mode: 'no-cors'
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Create and export singleton instance
export const domainVerification = new DomainVerificationService();
export default domainVerification; 