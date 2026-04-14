const express = require("express");
const router = express.Router();
const Store = require("../Models/store");
const mongoose = require('mongoose')


// ========================================
// ✅ ADD STORE
// ========================================
// router.post("/store/add", async (req, res) => {
//   try {
//     const { storeUrl, token } = req.body || {};

//     if (!storeUrl || !token) {
//       return res.status(400).json({ error: "Missing storeUrl or token" });
//     }

//     // 🔥 prevent duplicate store
//     const existing = await Store.findOne({ storeUrl });

//     if (existing) {
//       return res.status(400).json({ error: "Store already exists" });
//     }

//     const newStore = new Store({
//       storeUrl,
//       token,
//     });

//     await newStore.save();

//     res.json({ message: "Store added successfully", newStore });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// new api for store add
router.post("/store/add", async (req, res) => {
  try {
    let { domain, accessToken } = req.body;

    if (!domain || !accessToken) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // clean domain
    domain = domain.replace("https://", "");

    const newStore = await Store.create({
      domain,
      accessToken,
    });

    res.json({ success: true, store: newStore });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ GET ALL STORES
// ========================================
router.get("/store/", async (req, res) => {
  try {
    const stores = await Store.find().select("domain");
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ DELETE STORE
// ========================================
router.delete("/store/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("REQ PARAM ID:", req.params.id);

    // ✅ check valid Mongo ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const deleted = await Store.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Store not found" });
    }

    res.json({ message: "Store deleted successfully" });

  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ UPDATE STORE (BONUS 🔥)
// ========================================
router.put("/store/:id", async (req, res) => {
  try {
    let { domain, accessToken } = req.body;

    // ✅ validation
    if (!domain?.trim() || !accessToken?.trim()) {
      return res.status(400).json({
        error: "Domain and Access Token are required",
      });
    }

    // ✅ clean domain
    domain = domain.replace("https://", "");

    const updated = await Store.findByIdAndUpdate(
      req.params.id,
      { domain, accessToken },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Store not found" });
    }

    res.json(updated);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;