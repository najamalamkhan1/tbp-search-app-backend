const express = require("express");
const router = express.Router();
const Boost = require("../models/Boost");

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

module.exports = router;