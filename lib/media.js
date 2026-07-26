// Campaign image uploads for MMS. Files land in MEDIA_DIR (outside the deploy
// tree so a checkout can't clobber them) and are served at /media/<file>.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const MAX_UPLOAD = 2 * 1024 * 1024;   // what we accept from the browser
const TARGET = 480 * 1024;            // what we send; under the 600 KB carrier line
const MAX_PIXELS = 50e6;              // decode budget: w*h*frames, on a 2 GB box

const SUPPORTED = new Set(['jpeg', 'png', 'gif']);

// Quality ladders. First rung that fits TARGET wins.
const JPEG_RUNGS = [[1440, 80], [1440, 70], [1280, 70], [1024, 70], [1024, 60]];
const GIF_RUNGS = [[600, 128], [480, 96], [400, 64], [320, 48]];

function mediaDir(env) {
  return env.MEDIA_DIR || '/var/www/sms-media';
}

// Absolute, because Vonage and Kommo fetch the image from outside.
// new URL() rejects a malformed PUBLIC_BASE_URL instead of building a dead link.
function publicBase(env) {
  const base = env.PUBLIC_BASE_URL || 'https://sms.brintevaworlds.com';

  return new URL(base).origin.replace(/\/+$/, '');
}

// Trust magic bytes, never the browser-supplied name or mime.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  const ascii6 = buf.toString('ascii', 0, 6);
  if (ascii6 === 'GIF89a' || ascii6 === 'GIF87a') return 'gif';
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  // Detected only so the error can name it; never accepted.
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function slugify(name) {
  const raw = String(name || 'imagen');
  const base = path.basename(raw, path.extname(raw));
  const s = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60) || 'imagen';
}

// Filenames are <slug>-<token>.<ext>. The slug keeps them recognizable; the
// token keeps the public URL unguessable, since /media is served without auth.
function token() {
  return crypto.randomBytes(3).toString('hex');
}

// Earlier upload of the same name, ignoring the token. Null if this name is new.
async function findBySlug(dir, slug, ext) {
  const re = new RegExp(`^${slug}-[0-9a-f]{6}\\.${ext}$`);
  const files = await fs.readdir(dir).catch(() => []);
  return files.find(f => re.test(f)) || null;
}

// GIF keeps its format (animation). Everything else becomes JPEG — smaller, and
// MMS has no use for transparency.
async function compress(buf, format) {
  if (format === 'gif') {
    const meta = await sharp(buf, { animated: true }).metadata();
    const frames = meta.pages || 1;
    if (meta.width * (meta.pageHeight || meta.height) * frames > MAX_PIXELS) {
      throw Object.assign(new Error('El GIF es demasiado grande para procesar.'), { status: 413 });
    }
    if (buf.length <= TARGET) return { buf, ext: 'gif' };
    for (const [edge, colours] of GIF_RUNGS) {
      const out = await sharp(buf, { animated: true })
        .resize({ width: edge, fit: 'inside', withoutEnlargement: true })
        .gif({ colours, effort: 7, loop: meta.loop ?? 0 })
        .toBuffer();
      if (out.length <= TARGET) return { buf: out, ext: 'gif' };
    }
    // Photographic GIFs can't reach TARGET without turning to mush. Say so.
    throw Object.assign(
      new Error('Este GIF tiene demasiado movimiento para MMS. Usa un clip mas corto o una imagen fija.'),
      { status: 422 }
    );
  }

  const image = sharp(buf);
  const meta = await image.metadata();
  if (meta.width * meta.height > MAX_PIXELS) {
    throw Object.assign(new Error('La imagen es demasiado grande para procesar.'), { status: 413 });
  }
  for (const [edge, quality] of JPEG_RUNGS) {
    const out = await image
      .clone()
      .rotate()                                  // honour EXIF orientation
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })        // drop alpha; no transparency in MMS
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();                               // sharp strips EXIF (incl. GPS) by default
    if (out.length <= TARGET) return { buf: out, ext: 'jpg' };
  }
  throw Object.assign(new Error('No se pudo comprimir la imagen lo suficiente.'), { status: 422 });
}

// Compression peaks at ~11 s and hundreds of MB for animated GIFs; one at a time
// so concurrent uploads queue instead of exhausting the box.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function registerMediaRoutes(app, deps, requireAuth) {
  const { env } = deps;
  const dir = mediaDir(env);
  fs.mkdir(dir, { recursive: true })
    .catch(e => console.error({ route: 'media:init', dir, error: e.message }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

  app.use('/media', express.static(dir, { maxAge: '30d', index: false }));

  // onConflict: absent = 409 and let the user choose; 'copy' = suffix; 'replace' = overwrite.
  app.post('/api/media', requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });

      const format = sniff(req.file.buffer);
      if (!SUPPORTED.has(format)) {
        return res.status(415).json({
          error: format === 'webp'
            ? 'WEBP no es compatible con MMS. Usa JPG, PNG o GIF.'
            : 'Formato no reconocido. Usa JPG, PNG o GIF.'
        });
      }

      const { buf, ext } = await serialize(() => compress(req.file.buffer, format));

      const slug = slugify(req.file.originalname);
      const onConflict = String(req.query.onConflict || '');
      const previous = await findBySlug(dir, slug, ext);
      let filename;

      if (!previous || onConflict === 'copy') {
        filename = `${slug}-${token()}.${ext}`;
      } else if (onConflict === 'replace') {
        // Reuse the old name so the URL is stable — past campaigns show the new image too.
        filename = previous;
      } else {
        return res.status(409).json({
          error: `Ya subiste una imagen llamada ${slug}.${ext}`,
          conflict: true,
          filename: previous,
          existingUrl: `${publicBase(env)}/media/${previous}`
        });
      }

      // Write then rename so a reader never sees a partial file.
      const tmp = path.join(dir, `.tmp-${Date.now()}-${filename}`);
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, path.join(dir, filename));

      res.status(201).json({
        url: `${publicBase(env)}/media/${filename}`,
        filename,
        bytes: buf.length,
        originalBytes: req.file.size,
        format: ext
      });
    } catch (err) {
      console.error({
        route: '/api/media',
        filename: req.file?.originalname,
        error: err.message,
        stack: err.stack
      });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'La imagen supera 2 MB.' });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });
}

module.exports = { registerMediaRoutes, sniff, slugify, compress, mediaDir, publicBase, SUPPORTED };
