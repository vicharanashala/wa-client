import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * WhatsApp Flow Encryption Service
 * 
 * Implements Meta's encryption requirements:
 * - RSA/ECB/OAEPWithSHA-256AndMGF1Padding for AES key decryption
 * - AES-128-GCM for payload encryption/decryption
 * - Base64 encoding for all encrypted fields
 * 
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

@Injectable()
export class FlowEncryptionService {
  private readonly logger = new Logger(FlowEncryptionService.name);
  
  // RSA key pair (generate once, store securely)
  private privateKey: string;
  public publicKey: string;

  constructor() {
    // Try to load private key from environment, otherwise generate new one
    const envPrivateKey = process.env.FLOW_PRIVATE_KEY;

    if (envPrivateKey && envPrivateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      try {
        // Parse the key - handle both actual newlines and \n literal strings
        const cleanKey = envPrivateKey
          .replace(/\\n/g, '\n')  // Replace literal \n with actual newlines
          .trim();
        
        // Derive public key from private key
        const privateKeyObject = crypto.createPrivateKey(cleanKey);
        this.privateKey = cleanKey;
        // Create public key from private key object
        const publicKeyObject = crypto.createPublicKey(privateKeyObject);
        this.publicKey = publicKeyObject.export({ type: 'spki', format: 'pem' }) as string;
        this.logger.log('Flow encryption: Using private key from FLOW_PRIVATE_KEY env var');
      } catch (keyError) {
        this.logger.warn(`Failed to parse FLOW_PRIVATE_KEY: ${keyError}. Generating new key pair.`);
        this.generateNewKeyPair();
      }
    } else {
      // Generate new key pair (WARNING: key will change on restart!)
      this.generateNewKeyPair();
    }
  }

  /**
   * Generate new RSA key pair
   */
  private generateNewKeyPair(): void {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.logger.warn('Flow encryption: Generated new key pair (will change on restart!)');
  }

  /**
   * Decrypt incoming flow request from Meta
   * 
   * @param encryptedData - Object containing encrypted_flow_data, encrypted_aes_key, initial_vector
   */
  decryptFlowRequest(encryptedData: {
    encrypted_flow_data: string;
    encrypted_aes_key: string;
    initial_vector: string;
  }): { success: boolean; data?: any; error?: string } {
    try {
      // Step 1: Base64 decode the encrypted AES key
      const encryptedAesKeyBuffer = Buffer.from(encryptedData.encrypted_aes_key, 'base64');
      
      // Step 2: RSA-OAEP decrypt to get the AES key (16 bytes for AES-128)
      this.logger.log(`Encrypted AES key length: ${encryptedAesKeyBuffer.length} bytes (expected: 256 for RSA-2048)`);
      this.logger.log(`Using public key hash: ${crypto.createHash('sha256').update(this.publicKey).digest('hex').substring(0, 16)}...`);
      
      // Create KeyObject from private key for proper OAEP handling
      const privateKeyObject = crypto.createPrivateKey(this.privateKey);
      
      let aesKeyBuffer: Buffer;
      
      // Try with SHA-256 (Meta's standard)
      try {
        aesKeyBuffer = crypto.privateDecrypt(
          {
            key: privateKeyObject,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          },
          encryptedAesKeyBuffer,
        );
        this.logger.log('RSA-OAEP decryption with SHA-256 succeeded');
      } catch (sha256Error) {
        this.logger.warn('SHA-256 failed, trying SHA-1...');
        // Fallback to SHA-1
        try {
          aesKeyBuffer = crypto.privateDecrypt(
            {
              key: privateKeyObject,
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: 'sha1',
            },
            encryptedAesKeyBuffer,
          );
          this.logger.log('RSA-OAEP decryption with SHA-1 succeeded');
        } catch (sha1Error) {
          this.logger.error(`Both SHA-256 and SHA-1 failed. SHA-256: ${sha256Error}, SHA-1: ${sha1Error}`);
          throw sha1Error;
        }
      }

      // Verify AES key length (should be 16 bytes for AES-128)
      if (aesKeyBuffer.length !== 16) {
        this.logger.warn(`Unexpected AES key length: ${aesKeyBuffer.length} bytes`);
      }

      // Step 3: Base64 decode the initial vector
      const ivBuffer = Buffer.from(encryptedData.initial_vector, 'base64');

      // Step 4: Base64 decode the encrypted flow data
      const encryptedFlowDataBuffer = Buffer.from(encryptedData.encrypted_flow_data, 'base64');

      // Step 5: AES-GCM decrypt
      // Verify auth tag (last 16 bytes) - must be set BEFORE decryption
      const authTag = encryptedFlowDataBuffer.slice(-16);
      const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, ivBuffer);
      decipher.setAuthTag(authTag);
      
      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedFlowDataBuffer.slice(0, -16)), // Remove auth tag from end
        decipher.final(),
      ]);

      // Step 6: Parse JSON
      const decryptedJson = decryptedBuffer.toString('utf8');
      const data = JSON.parse(decryptedJson);

      this.logger.log('Flow request decrypted successfully');
      this.logger.log(`[FLOW ENCRYPT] Decrypted payload: ${JSON.stringify(data)}`);
      this.logger.log(`[FLOW ENCRYPT] Action field: "${data?.action}"`);
      return { success: true, data };

    } catch (error) {
      this.logger.error(`Failed to decrypt flow request: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Encrypt response to send back to Meta
   * 
   * @param data - JSON data to encrypt
   * @param encryptedRequest - Original encrypted request (to get AES key and IV)
   */
  encryptFlowResponse(
    data: any,
    encryptedRequest: {
      encrypted_flow_data: string;
      encrypted_aes_key: string;
      initial_vector: string;
    },
  ): { success: boolean; encrypted_data?: string; error?: string } {
    try {
      // Extract AES key from original request (same key is used for response)
      const encryptedAesKeyBuffer = Buffer.from(encryptedRequest.encrypted_aes_key, 'base64');
      const privateKeyObject = crypto.createPrivateKey(this.privateKey);
      const aesKeyBuffer = crypto.privateDecrypt(
        {
          key: privateKeyObject,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        encryptedAesKeyBuffer,
      );

      // Use the IV XOR'd with 0xFF for response (Meta spec requirement)
      const requestIv = Buffer.from(encryptedRequest.initial_vector, 'base64');
      const ivBuffer = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) {
        ivBuffer[i] = requestIv[i] ^ 0xFF;
      }

      // Encrypt the response data
      const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, ivBuffer);
      
      const jsonData = JSON.stringify(data);
      const encryptedBuffer = Buffer.concat([
        cipher.update(jsonData, 'utf8'),
        cipher.final(),
      ]);

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Combine encrypted data with auth tag (GCM requires this)
      const finalBuffer = Buffer.concat([encryptedBuffer, authTag]);

      // Base64 encode
      const encryptedDataBase64 = finalBuffer.toString('base64');

      this.logger.log('Flow response encrypted successfully');
      return { success: true, encrypted_data: encryptedDataBase64 };

    } catch (error) {
      this.logger.error(`Failed to encrypt flow response: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get public key for Meta Business Manager upload
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Get public key in one-line format (for Meta)
   * Replaces newlines with \n for easy copy-paste
   */
  getPublicKeyForMeta(): string {
    return this.publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\n/g, '')
      .trim();
  }
}