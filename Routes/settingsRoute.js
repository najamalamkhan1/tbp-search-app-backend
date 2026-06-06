const express = require("express");
const router = express.Router();
const Settings = require('../Models/settingsModel')
const Product = require("../Models/productModel");
const TrendingSettings = require("../Models/trendingSettingsModel");
const Synonym = require("../Models/synonymModel");
const Analytics = require("../Models/analyticsModel");
const fetch = require("node-fetch");

const normalizeStoreDomain = (shop) =>
  (shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

router.get('/settings', async (req, res) => {
    const { shop } = req.query;

    let settings = await Settings.findOne({ shop });

    if (!settings) {
        settings = await Settings.create({ shop });
    }

    res.json(settings);
})

router.put('/settings', async (req, res) => {
    const { shop, ...updates } = req.body;

    const settings = await Settings.findOneAndUpdate(
        { shop },
        { $set: updates },
        { new: true, upsert: true }
    );

    res.json(settings);
})

router.put('/settings/filters/order', async (req, res) => {
    const { shop, active } = req.body;

    const settings = await Settings.findOneAndUpdate(
        { shop },
        { "filters.active": active },
        { new: true }
    );

    res.json(settings);
});

router.post('/settings/reset', async (req, res) => {
    const { shop } = req.body;

    await Settings.findOneAndDelete({ shop });

    const newSettings = await Settings.create({ shop });

    res.json(newSettings);
})

// ============================================================
// TRENDING ADMIN CONTROLS
// ============================================================

// GET /api/admin/trending-settings
router.get("/admin/trending-settings", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    let settings = await TrendingSettings.findOne({ store });
    if (!settings) {
      settings = await TrendingSettings.create({ store });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/trending-settings
// Update analyticsWindowDays and/or maxTrendingProducts
router.put("/admin/trending-settings", async (req, res) => {
  try {
    const { shop, analyticsWindowDays, maxTrendingProducts } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const updates = {};
    if (analyticsWindowDays !== undefined) updates.analyticsWindowDays = Number(analyticsWindowDays);
    if (maxTrendingProducts !== undefined) updates.maxTrendingProducts = Number(maxTrendingProducts);

    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $set: updates },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/trending/pin-product
// Pin a product ID so it always appears first in trending
router.post("/admin/trending/pin-product", async (req, res) => {
  try {
    const { shop, productId } = req.body;
    if (!shop || !productId) return res.status(400).json({ error: "Shop and productId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $addToSet: { pinnedProductIds: String(productId) } },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/trending/pin-product
// Remove a pinned product
router.delete("/admin/trending/pin-product", async (req, res) => {
  try {
    const { shop, productId } = req.body;
    if (!shop || !productId) return res.status(400).json({ error: "Shop and productId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $pull: { pinnedProductIds: String(productId) } },
      { new: true }
    );
    res.json(settings || { pinnedProductIds: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/trending/pin-collection
// Pin a collection ID so it always appears first in trending collections
router.post("/admin/trending/pin-collection", async (req, res) => {
  try {
    const { shop, collectionId } = req.body;
    if (!shop || !collectionId) return res.status(400).json({ error: "Shop and collectionId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $addToSet: { pinnedCollectionIds: String(collectionId) } },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/trending/pin-collection
// Remove a pinned collection
router.delete("/admin/trending/pin-collection", async (req, res) => {
  try {
    const { shop, collectionId } = req.body;
    if (!shop || !collectionId) return res.status(400).json({ error: "Shop and collectionId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $pull: { pinnedCollectionIds: String(collectionId) } },
      { new: true }
    );
    res.json(settings || { pinnedCollectionIds: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/trending/pin-brand
// Pin a brand name so it always appears first in trending brands
router.post("/admin/trending/pin-brand", async (req, res) => {
  try {
    const { shop, brandName } = req.body;
    if (!shop || !brandName) return res.status(400).json({ error: "Shop and brandName required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $addToSet: { pinnedBrandNames: String(brandName) } },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/trending/pin-brand
// Remove a pinned brand
router.delete("/admin/trending/pin-brand", async (req, res) => {
  try {
    const { shop, brandName } = req.body;
    if (!shop || !brandName) return res.status(400).json({ error: "Shop and brandName required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $pull: { pinnedBrandNames: String(brandName) } },
      { new: true }
    );
    res.json(settings || { pinnedBrandNames: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/trending/clear-pins
// Clear all pinned items (products, collections, brands) for a store
router.post("/admin/trending/clear-pins", async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $set: { pinnedProductIds: [], pinnedCollectionIds: [], pinnedBrandNames: [] } },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SEARCH OPTIONS ADMIN CONTROL
// ============================================================

// PUT /api/admin/search-options
// body: { shop, searchInTitle, searchInDescription, searchInTags, searchInVendor, searchInVariants, searchInCollections }
router.put("/admin/search-options", async (req, res) => {
  try {
    const { shop, ...options } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const validFields = [
      "searchInTitle", "searchInDescription", "searchInTags",
      "searchInVendor", "searchInVariants", "searchInCollections"
    ];
    const updates = {};
    validFields.forEach(f => {
      if (options[f] !== undefined) updates[`searchOptions.${f}`] = Boolean(options[f]);
    });

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: updates },
      { new: true, upsert: true }
    );
    // Note: search.js settings cache expires in 1 min — changes take effect within 1 minute
    res.json(settings?.searchOptions || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/search-options
router.get("/admin/search-options", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    let settings = await Settings.findOne({ shop }).lean();
    if (!settings) settings = await Settings.create({ shop });
    res.json(settings?.searchOptions || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SYNONYMS ADMIN CRUD
// ============================================================

// GET /api/admin/synonyms?shop=xxx
router.get("/admin/synonyms", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });
    const store = normalizeStoreDomain(shop);
    const synonyms = await Synonym.find({ store }).sort({ query: 1 }).lean();
    res.json(synonyms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/synonyms
// Create or replace a synonym mapping
// body: { shop, query: "kameez", synonymWords: ["shirt", "kurta"] }
router.post("/admin/synonyms", async (req, res) => {
  try {
    const { shop, query, synonymWords } = req.body;
    if (!shop || !query) return res.status(400).json({ error: "Shop and query required" });
    if (!Array.isArray(synonymWords) || synonymWords.length === 0) {
      return res.status(400).json({ error: "synonymWords must be a non-empty array" });
    }

    const store = normalizeStoreDomain(shop);
    const normalizedQuery = query.toLowerCase().trim();

    const synonymObjects = synonymWords
      .map(w => w?.toString().toLowerCase().trim())
      .filter(Boolean)
      .map(word => ({ word, usageCount: 1, autoGenerated: false, confidence: 1 }));

    const doc = await Synonym.findOneAndUpdate(
      { store, query: normalizedQuery },
      { $set: { synonyms: synonymObjects } },
      { new: true, upsert: true }
    );
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/synonyms/:id
// Delete an entire synonym mapping
router.delete("/admin/synonyms/:id", async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });
    const store = normalizeStoreDomain(shop);

    const deleted = await Synonym.findOneAndDelete({ _id: req.params.id, store });
    if (!deleted) return res.status(404).json({ error: "Synonym not found" });
    res.json({ success: true, deleted: deleted.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/synonyms/:id/add-word
// Add a single word to an existing synonym mapping
// body: { shop, word: "dupatta" }
router.post("/admin/synonyms/:id/add-word", async (req, res) => {
  try {
    const { shop, word } = req.body;
    if (!shop || !word) return res.status(400).json({ error: "Shop and word required" });
    const store = normalizeStoreDomain(shop);

    const doc = await Synonym.findOneAndUpdate(
      { _id: req.params.id, store },
      {
        $addToSet: {
          synonyms: { word: word.toLowerCase().trim(), usageCount: 1, autoGenerated: false, confidence: 1 }
        }
      },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Synonym not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/synonyms/:id/remove-word
// Remove a single word from a synonym mapping
// body: { shop, word: "dupatta" }
router.delete("/admin/synonyms/:id/remove-word", async (req, res) => {
  try {
    const { shop, word } = req.body;
    if (!shop || !word) return res.status(400).json({ error: "Shop and word required" });
    const store = normalizeStoreDomain(shop);

    const doc = await Synonym.findOneAndUpdate(
      { _id: req.params.id, store },
      { $pull: { synonyms: { word: word.toLowerCase().trim() } } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Synonym not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/synonyms/suggestions?shop=xxx&days=30
// Zero-result queries that have no synonym yet — admin can use these to create synonyms
router.get("/admin/synonyms/suggestions", async (req, res) => {
  try {
    const { shop, days = 30 } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });
    const store = normalizeStoreDomain(shop);
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    const [zeroResults, existingSynonyms] = await Promise.all([
      Analytics.aggregate([
        { $match: { store, type: "search", resultsCount: 0, createdAt: { $gte: since } } },
        { $group: { _id: "$normalizedQuery", count: { $sum: 1 }, lastSearched: { $max: "$createdAt" } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]),
      Synonym.find({ store }).select("query").lean()
    ]);

    const existingSet = new Set(existingSynonyms.map(s => s.query));

    res.json(
      zeroResults
        .filter(z => z._id && !existingSet.has(z._id))
        .map(z => ({ query: z._id, searchCount: z.count, lastSearched: z.lastSearched }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SEARCH PERFORMANCE ANALYTICS
// ============================================================

// GET /api/admin/search-performance?shop=xxx&days=30
router.get("/admin/search-performance", async (req, res) => {
  try {
    const { shop, days = 30 } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const base = { store, createdAt: { $gte: since } };

    const [
      summaryData,
      topQueries,
      zeroResultQueries,
      topClickedProducts,
      dailyVolumeRaw,
      deviceBreakdown
    ] = await Promise.all([

      // Summary counts
      Analytics.aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            totalSearches: { $sum: { $cond: [{ $eq: ["$type", "search"] }, 1, 0] } },
            totalClicks:   { $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] } },
            zeroResults:   {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$type", "search"] }, { $eq: ["$resultsCount", 0] }] },
                  1, 0
                ]
              }
            }
          }
        }
      ]),

      // Top searched queries
      Analytics.aggregate([
        { $match: { ...base, type: "search" } },
        {
          $group: {
            _id: "$normalizedQuery",
            searchCount: { $sum: 1 },
            avgResults:  { $avg: "$resultsCount" }
          }
        },
        { $sort: { searchCount: -1 } },
        { $limit: 20 }
      ]),

      // Queries with zero results
      Analytics.aggregate([
        { $match: { ...base, type: "search", resultsCount: 0 } },
        {
          $group: {
            _id: "$normalizedQuery",
            count: { $sum: 1 },
            lastSearched: { $max: "$createdAt" }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),

      // Most clicked products
      Analytics.aggregate([
        { $match: { ...base, type: "click", productId: { $exists: true, $ne: null } } },
        {
          $group: {
            _id:          "$productId",
            clicks:       { $sum: 1 },
            productTitle: { $first: "$productTitle" },
            productHandle:{ $first: "$productHandle" }
          }
        },
        { $sort: { clicks: -1 } },
        { $limit: 20 }
      ]),

      // Daily search + click volume
      Analytics.aggregate([
        { $match: base },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              type: "$type"
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id.date": 1 } }
      ]),

      // Device breakdown
      Analytics.aggregate([
        { $match: { ...base, type: "search" } },
        { $group: { _id: "$device", count: { $sum: 1 } } }
      ])
    ]);

    const s = summaryData[0] || { totalSearches: 0, totalClicks: 0, zeroResults: 0 };
    const ctr = s.totalSearches > 0
      ? ((s.totalClicks / s.totalSearches) * 100).toFixed(1)
      : "0.0";
    const zeroResultRate = s.totalSearches > 0
      ? ((s.zeroResults / s.totalSearches) * 100).toFixed(1)
      : "0.0";

    // Fold daily volume into { date, searches, clicks }
    const dailyMap = {};
    dailyVolumeRaw.forEach(d => {
      const date = d._id.date;
      if (!dailyMap[date]) dailyMap[date] = { date, searches: 0, clicks: 0 };
      if (d._id.type === "search") dailyMap[date].searches = d.count;
      if (d._id.type === "click")  dailyMap[date].clicks  = d.count;
    });

    const devices = {};
    deviceBreakdown.forEach(d => { devices[d._id || "unknown"] = d.count; });

    res.json({
      period: { days: Number(days), since },
      summary: {
        totalSearches:   s.totalSearches,
        totalClicks:     s.totalClicks,
        ctr:             `${ctr}%`,
        zeroResultRate:  `${zeroResultRate}%`,
        zeroResultCount: s.zeroResults
      },
      topQueries: topQueries.map(q => ({
        query:       q._id || "(empty)",
        searchCount: q.searchCount,
        avgResults:  Math.round(q.avgResults || 0)
      })),
      zeroResultQueries: zeroResultQueries.map(z => ({
        query:       z._id || "(empty)",
        count:       z.count,
        lastSearched: z.lastSearched
      })),
      topClickedProducts: topClickedProducts.map(p => ({
        productId: p._id,
        title:     p.productTitle  || "Unknown",
        handle:    p.productHandle || "",
        clicks:    p.clicks
      })),
      dailyVolume:     Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      deviceBreakdown: devices
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;