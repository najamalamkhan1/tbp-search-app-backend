const express = require("express");
const router = express.Router();
const Synonym = require("../Models/synonymModel");

// ADD SYNONYM
router.post("/add", async (req, res) => {

  const { query, synonym, store } = req.body;

  try {

    const existing = await Synonym.findOne({
      query,
      store
    });

    if (existing) {

      existing.synonyms.push(synonym);
      await existing.save();

      return res.json(existing);
    }

    const newSynonym = await Synonym.create({
      query,
      synonyms: [synonym],
      store
    });

    res.json(newSynonym);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================
// 📋 LIST SYNONYMS
// =========================
router.get("/list", async (req, res) => {
  try {

    const { store } = req.query;

    const synonyms = await Synonym
      .find({ store })
      .sort({ createdAt: -1 });

    res.json({
      synonyms
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// 🗑 DELETE SYNONYM
// =========================
router.delete("/delete/:id", async (req, res) => {
  try {

    await Synonym.findByIdAndDelete(
      req.params.id
    );

    res.json({
      success: true
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;