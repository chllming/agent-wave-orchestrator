export function hasBucketConfig(config) {
  return Boolean(
    config?.storage?.bucketName &&
      config?.storage?.endpoint &&
      config?.storage?.accessKeyId &&
      config?.storage?.secretAccessKey,
  );
}

export async function createBucketStorage(config) {
  if (!hasBucketConfig(config)) {
    return null;
  }
  const [{ S3Client, PutObjectCommand, GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  const client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });
  return {
    async putObject({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.storage.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return key;
    },
    async getUploadUrl(key, contentType = "application/octet-stream") {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.storage.bucketName,
          Key: key,
          ContentType: contentType,
        }),
        {
          expiresIn: config.storage.signedUrlTtlSeconds,
        },
      );
    },
    async getDownloadUrl(key) {
      if (config.storage.publicBaseUrl) {
        return `${config.storage.publicBaseUrl.replace(/\/$/, "")}/${key}`;
      }
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.storage.bucketName,
          Key: key,
        }),
        {
          expiresIn: config.storage.signedUrlTtlSeconds,
        },
      );
    },
  };
}
