const cloudinary = require("cloudinary").v2;

const configured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET,
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function requireCloudinary() {
  if (!configured) {
    const error = new Error("Cloudinary is not configured on the backend");
    error.status = 503;
    throw error;
  }
  return cloudinary;
}

function createUploadSignature(folder = "team-emmanuel/gallery") {
  const client = requireCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { folder, timestamp };
  return {
    timestamp,
    folder,
    signature: client.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    ),
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
  };
}

module.exports = {
  cloudinary,
  configured,
  requireCloudinary,
  createUploadSignature,
};
