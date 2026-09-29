import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary server-side with user credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

export interface CloudinaryUploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
  resource_type: string;
}

/**
 * Upload a Base64 string or file buffer directly to Cloudinary
 */
export async function uploadToCloudinary(
  fileDataUri: string,
  folder: string = 'camera-erp-dev2/documents',
  resourceType: 'auto' | 'image' | 'raw' | 'video' = 'auto'
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      fileDataUri,
      {
        folder,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Upload failed'));
        }
        resolve({
          url: result.url,
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format || 'unknown',
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          resource_type: result.resource_type,
        });
      }
    );
  });
}

/**
 * Generate an optimized preview URL
 */
export function getOptimizedImageUrl(publicIdOrUrl: string, width = 600, height = 600): string {
  if (!publicIdOrUrl) return '/placeholder-camera.png';
  if (publicIdOrUrl.startsWith('http://') || publicIdOrUrl.startsWith('https://')) {
    return publicIdOrUrl;
  }
  return cloudinary.url(publicIdOrUrl, {
    width,
    height,
    crop: 'limit',
    quality: 'auto',
    fetch_format: 'auto',
  });
}
