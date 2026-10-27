import { createClient } from '@supabase/supabase-js';

export const PHOTO_BUCKET = 'animal-photos';
export const RECEIPT_BUCKET = 'receipts';

/** Private photo storage. Clients only ever get short-lived signed URLs. */
export interface Photos {
  createUploadUrl(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  createDownloadUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

export function supabasePhotos(supabaseUrl: string, secretKey: string, bucket = PHOTO_BUCKET): Photos {
  const storage = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } }).storage.from(bucket);
  return {
    async createUploadUrl(path) {
      const { data, error } = await storage.createSignedUploadUrl(path);
      if (error) throw error;
      return data.signedUrl;
    },
    async exists(path) {
      const { data, error } = await storage.exists(path);
      if (error) throw error;
      return data;
    },
    async createDownloadUrl(path, expiresInSeconds) {
      const { data, error } = await storage.createSignedUrl(path, expiresInSeconds);
      if (error) throw error;
      return data.signedUrl;
    },
    async remove(path) {
      const { error } = await storage.remove([path]);
      if (error) throw error;
    },
  };
}
