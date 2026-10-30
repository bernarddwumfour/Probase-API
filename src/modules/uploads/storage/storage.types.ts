export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageDriver {
  createUploadTarget(o: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTarget>;
  stat(key: string): Promise<{ sizeBytes: number; contentType?: string } | null>;
  publicUrl(key: string): string;
  remove(key: string): Promise<void>;
}