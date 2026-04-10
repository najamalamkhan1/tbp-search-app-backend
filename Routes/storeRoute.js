const express = require("express");
const router = express.Router();
const Store = require("../Models/store");


// ========================================
// ✅ ADD STORE
// ========================================
// router.post("/add", async (req, res) => {
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
router.post("/add", async (req, res) => {
  try {
    const { storeUrl, token } = req.body || {};

    // ✅ 1. Basic validation
    if (!storeUrl || !token) {
      return res.status(400).json({ error: "Missing storeUrl or token" });
    }

    // ✅ 2. Duplicate check
    const existing = await Store.findOne({ storeUrl });

    if (existing) {
      return res.status(400).json({ error: "Store already exists" });
    }

    // ✅ 3. Shopify validation (IMPORTANT 🔥)
    const response = await fetch(
      `https://${storeUrl}/admin/api/2024-01/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return res.status(400).json({
        error: "Invalid store URL or access token",
      });
    }

    const shopData = await response.json();

    // ✅ 4. Save store
    const newStore = new Store({
      storeUrl,
      token,
      shopName: shopData.shop.name, // optional but useful
    });

    await newStore.save();

    res.json({
      message: "Store added successfully",
      store: newStore,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ GET ALL STORES
// ========================================
router.get("/", async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ DELETE STORE
// ========================================
router.delete("/:id", async (req, res) => {
  try {
    await Store.findByIdAndDelete(req.params.id);
    res.json({ message: "Store deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// ✅ UPDATE STORE (BONUS 🔥)
// ========================================
router.put("/:id", async (req, res) => {
  try {
    const { storeUrl, token } = req.body;

    // 🔥 VALIDATION
    if (!storeUrl?.trim() || !token?.trim()) {
      return res.status(400).json({
        error: "Store URL and Token are required",
      });
    }

    const updated = await Store.findByIdAndUpdate(
      req.params.id,
      { storeUrl, token },
      { new: true }
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}); 


module.exports = router;