const express = require("express");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { authenticateToken, requireStaff } = require("../middleware/auth");
const {
  requireCloudinary,
  createUploadSignature,
} = require("../config/cloudinary");

const router = express.Router();

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

router.get("/albums", async (req, res) => {
  try {
    const result = await query(`
      SELECT a.*, COUNT(i.id)::int AS image_count
      FROM gallery_albums a
      LEFT JOIN gallery_images i ON i.album_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);
    res.json({ albums: result.rows });
  } catch (error) {
    console.error("Error fetching gallery albums:", error);
    res.status(500).json({ error: "Failed to fetch gallery albums" });
  }
});

router.get("/", async (req, res) => {
  const { album_id: albumId, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const values = [];
  let where = "";
  if (albumId) {
    values.push(albumId);
    where = `WHERE i.album_id = $${values.length}`;
  }
  values.push(Number(limit), offset);
  try {
    const result = await query(
      `
      SELECT i.*, a.title AS album_name
      FROM gallery_images i
      LEFT JOIN gallery_albums a ON a.id = i.album_id
      ${where}
      ORDER BY i.sort_order ASC, i.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
      values,
    );
    const count = await query(
      `SELECT COUNT(*)::int AS total FROM gallery_images i ${where}`,
      values.slice(0, albumId ? 1 : 0),
    );
    res.json({
      images: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count.rows[0].total,
        pages: Math.ceil(count.rows[0].total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching gallery images:", error);
    res.status(500).json({ error: "Failed to fetch gallery images" });
  }
});

router.get("/upload-signature", authenticateToken, requireStaff, (req, res) => {
  try {
    res.json(
      createUploadSignature(req.query.folder || "team-emmanuel/gallery"),
    );
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post(
  "/albums",
  authenticateToken,
  requireStaff,
  [body("name").trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });
    const { name, description, category, status = "draft" } = req.body;
    try {
      const result = await query(
        `
      INSERT INTO gallery_albums (title, slug, description, category, status)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `,
        [
          name,
          `${slugify(name)}-${Date.now()}`,
          description || null,
          category || null,
          status,
        ],
      );
      res.status(201).json({ album: result.rows[0] });
    } catch (error) {
      console.error("Error creating gallery album:", error);
      res.status(500).json({ error: "Failed to create gallery album" });
    }
  },
);

router.post(
  "/",
  authenticateToken,
  requireStaff,
  [
    body("album_id").isUUID(),
    body("title").trim().notEmpty(),
    body("image_url").isURL(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });
    const {
      album_id,
      title,
      description,
      image_url,
      thumbnail_url,
      cloudinary_public_id,
      width,
      height,
      file_size,
      sort_order = 0,
      is_cover = false,
    } = req.body;
    try {
      const result = await query(
        `
      INSERT INTO gallery_images
        (album_id, title, description, image_url, thumbnail_url, cloudinary_public_id, width, height, file_size, sort_order, is_cover)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `,
        [
          album_id,
          title,
          description || null,
          image_url,
          thumbnail_url || image_url,
          cloudinary_public_id || null,
          width || null,
          height || null,
          file_size || null,
          sort_order,
          is_cover,
        ],
      );
      await query(
        "UPDATE gallery_albums SET image_count = (SELECT COUNT(*) FROM gallery_images WHERE album_id = $1), cover_image_url = CASE WHEN $2 THEN $3 ELSE cover_image_url END, updated_at = NOW() WHERE id = $1",
        [album_id, is_cover, image_url],
      );
      res.status(201).json({ image: result.rows[0] });
    } catch (error) {
      console.error("Error saving gallery image:", error);
      res.status(500).json({ error: "Failed to save gallery image" });
    }
  },
);

router.put("/:id", authenticateToken, requireStaff, async (req, res) => {
  const { title, description, sort_order, is_cover } = req.body;
  try {
    const result = await query(
      `UPDATE gallery_images SET title=COALESCE($1,title), description=COALESCE($2,description), sort_order=COALESCE($3,sort_order), is_cover=COALESCE($4,is_cover), updated_at=NOW() WHERE id=$5 RETURNING *`,
      [title, description, sort_order, is_cover, req.params.id],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Image not found" });
    res.json({ image: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: "Failed to update gallery image" });
  }
});

router.delete("/:id", authenticateToken, requireStaff, async (req, res) => {
  try {
    const existing = await query(
      "SELECT cloudinary_public_id FROM gallery_images WHERE id = $1",
      [req.params.id],
    );
    if (!existing.rows.length)
      return res.status(404).json({ error: "Image not found" });
    const publicId = existing.rows[0].cloudinary_public_id;
    if (publicId)
      await requireCloudinary().uploader.destroy(publicId, {
        resource_type: "image",
      });
    await query("DELETE FROM gallery_images WHERE id = $1", [req.params.id]);
    res.json({ message: "Image deleted successfully" });
  } catch (error) {
    console.error("Error deleting gallery image:", error);
    res.status(500).json({ error: "Failed to delete gallery image" });
  }
});

module.exports = router;
