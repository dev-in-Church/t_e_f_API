const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticateToken, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/gallery');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Get all gallery images (public)
router.get('/', async (req, res) => {
  const { category, limit = 50, offset = 0 } = req.query;

  try {
    let queryText = `
      SELECT id, title, description, image_url, thumbnail_url, category, 
             alt_text, is_featured, created_at
      FROM gallery_images 
      WHERE is_active = true
    `;
    const queryParams = [];

    if (category && category !== 'All') {
      queryText += ` AND category = $1`;
      queryParams.push(category);
    }

    queryText += ` ORDER BY is_featured DESC, created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, queryParams);

    // Get categories
    const categories = await query(
      `SELECT DISTINCT category FROM gallery_images WHERE is_active = true ORDER BY category`
    );

    res.json({
      images: result.rows,
      categories: ['All', ...categories.rows.map(c => c.category)],
    });
  } catch (error) {
    console.error('Error fetching gallery:', error);
    res.status(500).json({ error: 'Failed to fetch gallery' });
  }
});

// Get single image (public)
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM gallery_images WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json({ image: result.rows[0] });
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// Upload image (admin)
router.post('/', authenticateToken, requireStaff, upload.single('image'), [
  body('title').trim().notEmpty(),
  body('category').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  const { title, description, category, alt_text, is_featured } = req.body;
  const imageUrl = `/uploads/gallery/${req.file.filename}`;

  try {
    const result = await query(
      `INSERT INTO gallery_images 
       (title, description, image_url, thumbnail_url, category, alt_text, is_featured, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description, imageUrl, imageUrl, category, alt_text || title, is_featured || false, req.user.id]
    );

    res.status(201).json({ image: result.rows[0] });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Update image (admin)
router.put('/:id', authenticateToken, requireStaff, async (req, res) => {
  const { title, description, category, alt_text, is_featured, is_active } = req.body;

  try {
    const result = await query(
      `UPDATE gallery_images SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       category = COALESCE($3, category),
       alt_text = COALESCE($4, alt_text),
       is_featured = COALESCE($5, is_featured),
       is_active = COALESCE($6, is_active),
       updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [title, description, category, alt_text, is_featured, is_active, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json({ image: result.rows[0] });
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(500).json({ error: 'Failed to update image' });
  }
});

// Delete image (admin)
router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM gallery_images WHERE id = $1 RETURNING id, image_url',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // In production, also delete the file from storage
    // fs.unlinkSync(path.join(__dirname, '..', '..', result.rows[0].image_url));

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Bulk upload (admin)
router.post('/bulk', authenticateToken, requireStaff, upload.array('images', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const { category } = req.body;
  const uploadedImages = [];

  try {
    for (const file of req.files) {
      const imageUrl = `/uploads/gallery/${file.filename}`;
      const title = file.originalname.replace(/\.[^/.]+$/, '');

      const result = await query(
        `INSERT INTO gallery_images 
         (title, image_url, thumbnail_url, category, alt_text, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title, imageUrl, imageUrl, category || 'General', title, req.user.id]
      );

      uploadedImages.push(result.rows[0]);
    }

    res.status(201).json({
      message: `${uploadedImages.length} images uploaded successfully`,
      images: uploadedImages,
    });
  } catch (error) {
    console.error('Error bulk uploading:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

module.exports = router;
