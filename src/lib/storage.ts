import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const runtimeEnv = process.env.APP_RUNTIME_ENV || process.env.NODE_ENV || 'production';
const isProd = runtimeEnv === 'production';
const storageAdapter = (process.env.FILE_STORAGE_ADAPTER || 'local').trim().toLowerCase();
const useObjectStorage = storageAdapter === 's3' || storageAdapter === 'object-storage';

let _storage: ObjectStorageClient | null = null;

interface ObjectStorageConfig {
  endpointUrl: string;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  region: string;
}

type ObjectStorageClient = {
  client: S3Client;
  bucketName: string;
};

function envAlias(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readObjectStorageConfig(): ObjectStorageConfig {
  const endpointUrl = envAlias('S3_ENDPOINT_URL', 'OBJECT_STORAGE_ENDPOINT_URL');
  const accessKey = envAlias('S3_ACCESS_KEY_ID', 'OBJECT_STORAGE_ACCESS_KEY_ID');
  const secretKey = envAlias('S3_SECRET_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_ACCESS_KEY');
  const bucketName = envAlias('S3_BUCKET', 'S3_BUCKET_NAME', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_BUCKET_NAME');
  const region = envAlias('S3_REGION', 'OBJECT_STORAGE_REGION');

  if (!endpointUrl || !accessKey || !secretKey || !bucketName || !region) {
    throw new Error('对象存储未配置完整：FILE_STORAGE_ADAPTER=s3 时需要 S3_ENDPOINT_URL、S3_REGION、S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY，或对应 OBJECT_STORAGE_* 配置。');
  }

  return { endpointUrl, accessKey, secretKey, bucketName, region };
}

export function isObjectStorageConfigured(): boolean {
  try {
    readObjectStorageConfig();
    return true;
  } catch {
    return false;
  }
}

export function sanitizeStoredFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() || 'upload';
  const safeName = baseName
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*\x7f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 140);

  return safeName || 'upload';
}

function getStorage(): ObjectStorageClient {
  if (!_storage) {
    const config = readObjectStorageConfig();
    const clientConfig: S3ClientConfig = {
      endpoint: config.endpointUrl,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    };
    _storage = {
      client: new S3Client(clientConfig),
      bucketName: config.bucketName,
    };
  }
  return _storage;
}

function uniqueObjectKey(prefix: string, fileName: string): string {
  const safeName = sanitizeStoredFileName(fileName);
  return `${prefix.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  }
  const stream = body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * 判断当前是否为生产环境
 */
export function isProduction(): boolean {
  return isProd;
}

export function isUsingObjectStorage(): boolean {
  return useObjectStorage;
}

/**
 * 获取文件的可访问 URL
 * - local：直接返回本地路径（如 /uploads/xxx.pdf）
 * - s3/object-storage：通过 S3 key 生成签名 URL
 */
export async function resolveFileUrl(fileKeyOrPath: string): Promise<string> {
  if (!useObjectStorage) {
    // 本地文件存储：fileKeyOrPath 就是本地静态路径如 /uploads/xxx.pdf
    return fileKeyOrPath;
  }
  // 对象存储：fileKeyOrPath 是 S3 key
  const storage = getStorage();
  return getSignedUrl(
    storage.client,
    new GetObjectCommand({ Bucket: storage.bucketName, Key: fileKeyOrPath }),
    { expiresIn: 86400 },
  );
}

/**
 * 上传文件
 * - local：保存到 public/uploads/，返回本地路径
 * - s3/object-storage：上传到 S3，返回 S3 key
 */
export async function storeFile(
  buffer: Buffer,
  fileName: string,
  contentType?: string,
): Promise<{ key: string; localPath?: string }> {
  if (!useObjectStorage) {
    // 本地文件存储：保存到 public/uploads/，可用于开发和显式 local 生产部署。
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const savedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeStoredFileName(fileName)}`;
    const savedPath = path.join(uploadDir, savedName);
    await writeFile(savedPath, buffer);
    return { key: `/uploads/${savedName}`, localPath: savedPath };
  }

  // 对象存储：上传到 S3
  const storage = getStorage();
  const s3Key = uniqueObjectKey('uploads', fileName);
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucketName,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  }));
  return { key: s3Key };
}

/**
 * 获取文件内容
 * - local：从本地路径读取
 * - s3/object-storage：从 S3 下载
 */
export async function retrieveFileBuffer(fileKeyOrPath: string): Promise<Buffer> {
  if (!useObjectStorage) {
    // 本地文件存储：fileKeyOrPath 是本地路径如 /uploads/xxx.pdf
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullPath = path.join(process.cwd(), 'public', fileKeyOrPath.replace(/^\//, ''));
    return fs.readFile(fullPath);
  }

  // 对象存储：从 S3 读取
  const storage = getStorage();
  const response = await storage.client.send(new GetObjectCommand({
    Bucket: storage.bucketName,
    Key: fileKeyOrPath,
  }));
  return bodyToBuffer(response.Body);
}

export async function listStoredFileKeys(prefix: string, maxKeys = 100): Promise<string[]> {
  if (!useObjectStorage) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    const basePath = path.join(process.cwd(), 'public', normalizedPrefix);
    const keys: string[] = [];

    async function walk(dir: string, relativePrefix: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (keys.length >= maxKeys) return;
        const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else {
          keys.push(`${normalizedPrefix}/${relativePath}`.replace(/\\/g, '/'));
        }
      }
    }

    try {
      await walk(basePath, '');
    } catch {
      return [];
    }
    return keys;
  }

  const storage = getStorage();
  const response = await storage.client.send(new ListObjectsV2Command({
    Bucket: storage.bucketName,
    Prefix: prefix.replace(/^\/+/, ''),
    MaxKeys: maxKeys,
  }));
  return (response.Contents || [])
    .map(item => item.Key)
    .filter((key): key is string => Boolean(key));
}

/**
 * 保存 MinerU 图表
 * - local：保存到 public/mineru-figures/
 * - s3/object-storage：上传到 S3，返回 S3 key
 */
export async function storeMinerUFigure(
  buffer: Buffer,
  paperId: string,
  figureName: string,
  contentType?: string,
): Promise<{ key: string; accessUrl: string }> {
  if (!useObjectStorage) {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    const figuresDir = path.join(process.cwd(), 'public', 'mineru-figures', paperId);
    await mkdir(figuresDir, { recursive: true });
    const savedPath = path.join(figuresDir, figureName);
    await writeFile(savedPath, buffer);
    const localPath = `/mineru-figures/${paperId}/${figureName}`;
    return { key: localPath, accessUrl: localPath };
  }

  // 对象存储：上传到 S3
  const storage = getStorage();
  const s3Key = `mineru-figures/${sanitizeStoredFileName(paperId)}/${sanitizeStoredFileName(figureName)}`;
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucketName,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType || 'image/png',
  }));
  const accessUrl = await getSignedUrl(
    storage.client,
    new GetObjectCommand({ Bucket: storage.bucketName, Key: s3Key }),
    { expiresIn: 86400 },
  );
  return { key: s3Key, accessUrl };
}

/**
 * 保存 MinerU 元数据
 */
export async function storeMinerUMetadata(
  data: string,
  paperId: string,
): Promise<{ key: string }> {
  if (!useObjectStorage) {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    const figuresDir = path.join(process.cwd(), 'public', 'mineru-figures', paperId);
    await mkdir(figuresDir, { recursive: true });
    await writeFile(path.join(figuresDir, '_metadata.json'), data);
    return { key: `mineru-figures/${paperId}/_metadata.json` };
  }

  const storage = getStorage();
  const s3Key = `mineru-figures/${sanitizeStoredFileName(paperId)}/_metadata.json`;
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucketName,
    Key: s3Key,
    Body: Buffer.from(data, 'utf-8'),
    ContentType: 'application/json',
  }));
  return { key: s3Key };
}

/**
 * 下载文件到临时目录（用于 MinerU/PPT 等需要本地文件路径的场景）
 */
export async function downloadToTemp(fileKeyOrPath: string, tempName: string): Promise<string> {
  const buffer = await retrieveFileBuffer(fileKeyOrPath);
  const { writeFile, mkdir } = await import('fs/promises');
  const path = await import('path');
  const tmpDir = '/tmp/uploads';
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, tempName);
  await writeFile(tmpPath, buffer);
  return tmpPath;
}
