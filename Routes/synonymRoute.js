const express = require("express");
const router = express.Router();
const Synonym = require("../models/Synonym");

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

module.exports = router;