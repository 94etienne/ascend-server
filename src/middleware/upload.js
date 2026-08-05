import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/* Photos go in one folder, documents (recommendation letters and
   payment receipts) in another — keeps them easy to reason about
   and to back up separately. */
const PHOTO_DIR = "uploads/photos";
const DOC_DIR = "uploads/docs";

fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(DOC_DIR, { recursive: true });

const IMAGE_EXT = [".jpg", ".jpeg", ".png"];
const DOC_EXT = [".jpg", ".jpeg", ".png", ".pdf"];

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    /* The passport photo is an image for the ID badge; the
       recommendation and receipt are documents (often PDF). */
    cb(null, file.fieldname === "photo" ? PHOTO_DIR : DOC_DIR);
  },

  filename: (_req, file, cb) => {
    /* Never trust the uploaded filename — generate our own so a
       name like "../../server.js" can't escape the folder. */
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = file.fieldname === "photo" ? IMAGE_EXT : DOC_EXT;
    const safe = allowed.includes(ext) ? ext : ".dat";
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${file.fieldname}-${Date.now()}-${id}${safe}`);
  },
});

function fileFilter(_req, file, cb) {
  if (file.fieldname === "photo") {
    if (!/^image\/(jpe?g|png)$/.test(file.mimetype)) {
      return cb(new Error("The passport photo must be a JPG or PNG image."));
    }
  } else {
    /* recommendation + receipt: image or PDF */
    if (!/^(image\/(jpe?g|png)|application\/pdf)$/.test(file.mimetype)) {
      return cb(
        new Error("Documents must be a PDF, JPG, or PNG file.")
      );
    }
  }
  cb(null, true);
}

/* Accept the three named fields, one file each. */
export const uploadApplicationFiles = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB — receipts/letters can be bigger than a photo
    files: 3,
  },
}).fields([
  { name: "photo", maxCount: 1 },
  { name: "recommendation", maxCount: 1 },
  { name: "receipt", maxCount: 1 },
]);

/* Wrap multer so its errors come back as clean JSON. */
export function handleApplicationUpload(req, res, next) {
  uploadApplicationFiles(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "A file is too large. Keep each under 5 MB." });
    }
    return res.status(400).json({ error: err.message });
  });
}
