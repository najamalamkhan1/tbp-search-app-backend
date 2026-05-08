const express = require("express");
const router = express.Router();
const Boost = require("../Models/boostModel");

router.post("/add", async (req, res) => {

  const { query, productId, store } = req.body;

  try {

    const boost = await Boost.create({
      query,
      productId,
      store
    });

    res.json(boost);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// 📋 LIST BOOSTS
// =========================
router.get("/list", async (req, res) => {
  try {

    const { store } = req.query;

    const boosts = await Boost
      .find({ store })
      .sort({ createdAt: -1 });

    res.json({
      boosts
    });

  } catch (err) {

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// 🗑 DELETE BOOST
// =========================
router.delete("/delete/:id", async (req, res) => {
  try {

    await Boost.findByIdAndDelete(
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