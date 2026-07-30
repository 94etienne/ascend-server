import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DIR = "uploads/photos";

/* Create the folder on boot — multer won't do it for you,
   and the error it throws otherwise is unhelpfully vague. */
fs.mkdirSync(DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DIR),

  filename: (_req, file, cb) => {
    /* Never trust the uploaded filename. A file called
       "../../server.js" would otherwise let someone write
       outside the upload folder. Generate our own name. */
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = [".jpg", ".jpeg", ".png"].includes(ext) ? ext : ".jpg";
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}-${id}${safe}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!/^image\/(jpe?g|png)$/.test(file.mimetype)) {
    return cb(new Error("The passport photo must be a JPG or PNG image."));
  }
  cb(null, true);
}

export const uploadPhoto = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB — matches MAX_PHOTO_MB on the client
    files: 1,
  },
}).single("photo");

/* Wrap multer so its errors come back as clean JSON instead of
   an HTML stack trace. */
export function handlePhotoUpload(req, res, next) {
  uploadPhoto(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "That photo is too large. Keep it under 2 MB." });
    }
    return res.status(400).json({ error: err.message });
  });
}
