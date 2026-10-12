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
  private readonly privateKey: string;
  public readonly publicKey: string;

  constructor() {
    // Generate RSA-2048 key pair
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

    this.logger.log('Flow encryption keys generated');
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
      const aesKeyBuffer = crypto.privateDecrypt(
        {
          key: this.privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        encryptedAesKeyBuffer,
      );

      // Verify AES key length (should be 16 bytes for AES-128)
      if (aesKeyBuffer.length !== 16) {
        this.logger.warn(`Unexpected AES key length: ${aesKeyBuffer.length} bytes`);
      }

      // Step 3: Base64 decode the initial vector
      const ivBuffer = Buffer.from(encryptedData.initial_vector, 'base64');

      // Step 4: Base64 decode the encrypted flow data
      const encryptedFlowDataBuffer = Buffer.from(encryptedData.encrypted_flow_data, 'base64');

      // Step 5: AES-GCM decrypt
      const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, ivBuffer);
      
      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedFlowDataBuffer.slice(0, -16)), // Remove auth tag from end
        decipher.final(),
      ]);

      // Verify auth tag (last 16 bytes)
      const authTag = encryptedFlowDataBuffer.slice(-16);
      decipher.setAuthTag(authTag);

      // Step 6: Parse JSON
      const decryptedJson = decryptedBuffer.toString('utf8');
      const data = JSON.parse(decryptedJson);

      this.logger.log('Flow request decrypted successfully');
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
      const aesKeyBuffer = crypto.privateDecrypt(
        {
          key: this.privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        encryptedAesKeyBuffer,
      );

      // Use the same IV for consistency
      const ivBuffer = Buffer.from(encryptedRequest.initial_vector, 'base64');

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