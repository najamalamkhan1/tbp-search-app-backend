const express = require("express");
const router = express.Router();
const Settings = require('../Models/settingsModel')
const Product = require("../Models/productModel");
const Collection = require("../Models/collectionModel");
const TrendingSettings = require("../Models/trendingSettingsModel");
const Synonym = require("../Models/synonymModel");
const Analytics = require("../Models/analyticsModel");
const fetch = require("node-fetch");
const searchRoute = require('./search');

const normalizeStoreDomain = (shop) =>
  (shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

const DEFAULT_FILTERS = {
  enabled: true,
  active: ["availability", "vendor", "collection", "size", "color", "productType", "price"],
  hideOutOfStock: false
};

const ALLOWED_FILTERS = [
  "availability",
  "vendor",
  "collection",
  "collections",
  "size",
  "sizes",
  "color",
  "productType",
  "product_type",
  "type",
  "price",
  "tag",
  "category"
];

const FILTER_ALIASES = {
  collections: "collection",
  sizes: "size",
  product_type: "productType",
  type: "productType",
  category: "tag"
};

const normalizeFilterKey = (key) => FILTER_ALIASES[key] || key;

const normalizeCollectionId = (id) =>
  String(id || "").replace("gid://shopify/Collection/", "").trim();

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

    searchRoute.clearSettingsCache(shop);
    searchRoute.clearSearchCache(shop);
    res.json(settings);
})

// PUT /api/settings/country
// body: { shop, country }
router.put('/settings/country', async (req, res) => {
  try {
    const { shop, country } = req.body;
    if (!shop || !country) return res.status(400).json({ error: "Shop and country required" });

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: { country: country.trim() } },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);
    res.json({ country: settings.country });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/filters/order', async (req, res) => {
    const { shop, active } = req.body;

    const settings = await Settings.findOneAndUpdate(
        { shop },
        {
          "filters.active": Array.isArray(active)
            ? [...new Set(active.filter(f => ALLOWED_FILTERS.includes(f)).map(normalizeFilterKey))]
            : []
        },
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearTrendingCache(store);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TRENDING EXCLUDE (remove products from trending)
// ============================================================

// POST /api/admin/trending/exclude-product
// body: { shop, productId }  — hide this product from trending permanently
router.post("/admin/trending/exclude-product", async (req, res) => {
  try {
    const { shop, productId } = req.body;
    if (!shop || !productId) return res.status(400).json({ error: "Shop and productId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      {
        $addToSet: { excludedProductIds: String(productId) },
        $pull:     { pinnedProductIds:   String(productId) }  // remove from pinned too if present
      },
      { new: true, upsert: true }
    );
    searchRoute.clearTrendingCache(store);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/trending/exclude-product
// body: { shop, productId }  — restore product back to trending pool
router.delete("/admin/trending/exclude-product", async (req, res) => {
  try {
    const { shop, productId } = req.body;
    if (!shop || !productId) return res.status(400).json({ error: "Shop and productId required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $pull: { excludedProductIds: String(productId) } },
      { new: true }
    );
    searchRoute.clearTrendingCache(store);
    res.json(settings || { excludedProductIds: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/trending/excluded-products?shop=xxx
// List all currently excluded product IDs
router.get("/admin/trending/excluded-products", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOne({ store }).lean();
    res.json({ excludedProductIds: settings?.excludedProductIds || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/trending/clear-excluded
// Clear all excluded products (restore all to trending pool)
router.post("/admin/trending/clear-excluded", async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const settings = await TrendingSettings.findOneAndUpdate(
      { store },
      { $set: { excludedProductIds: [] } },
      { new: true, upsert: true }
    );
    searchRoute.clearTrendingCache(store);
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
    searchRoute.clearSettingsCache(shop);
    searchRoute.clearSearchCache(shop);
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
// SEARCH SETTINGS ADMIN CONTROL
// (typoEnabled, typoTolerance, defaultSort, synonymsEnabled, searchType)
// ============================================================

// GET /api/admin/search-settings?shop=xxx
router.get("/admin/search-settings", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    let settings = await Settings.findOne({ shop }).lean();
    if (!settings) settings = await Settings.create({ shop });
    res.json(settings?.searchSettings || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/search-settings
// body: { shop, typoEnabled, typoSuggestionsEnabled, typoSuggestionsAiEnabled, typoTolerance, defaultSort, synonymsEnabled, type, maxResults }
router.put("/admin/search-settings", async (req, res) => {
  try {
    const { shop, typoEnabled, typoSuggestionsEnabled, typoSuggestionsAiEnabled, typoTolerance, defaultSort, synonymsEnabled, type, maxResults } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const validFields = { typoEnabled, typoTolerance, defaultSort, synonymsEnabled, type, maxResults };
    const updates = {};
    if (typoEnabled      !== undefined) updates["searchSettings.typoEnabled"]      = Boolean(typoEnabled);
    if (typoSuggestionsEnabled   !== undefined) updates["searchSettings.typoSuggestionsEnabled"]   = Boolean(typoSuggestionsEnabled);
    if (typoSuggestionsAiEnabled !== undefined) updates["searchSettings.typoSuggestionsAiEnabled"] = Boolean(typoSuggestionsAiEnabled);
    if (typoTolerance    !== undefined) updates["searchSettings.typoTolerance"]    = String(typoTolerance);
    if (defaultSort      !== undefined) updates["searchSettings.defaultSort"]      = String(defaultSort);
    if (synonymsEnabled  !== undefined) updates["searchSettings.synonymsEnabled"]  = Boolean(synonymsEnabled);
    if (type             !== undefined) updates["searchSettings.type"]             = String(type);
    if (maxResults       !== undefined) updates["searchSettings.maxResults"]       = Number(maxResults);

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: updates },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);
    searchRoute.clearSearchCache(shop);
    res.json(settings?.searchSettings || {});
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
// AUTO-SYNONYM DETECTION
// ============================================================

// POST /api/admin/synonyms/auto-detect
// Analyzes click behavior: which products users click for each query →
// extracts common tags from those products → saves as synonym candidates
//
// body: {
//   shop,
//   threshold: 10,    // min total clicks on a query before analyzing (default 10)
//   days: 30,         // analytics window (default 30)
//   autoSave: false   // false = preview only, true = save to DB automatically
// }
router.post("/admin/synonyms/auto-detect", async (req, res) => {
  try {
    const { shop, threshold = 10, days = 30, autoSave = false } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const store = normalizeStoreDomain(shop);
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const minClicks = Math.max(1, Number(threshold));

    // ─────────────────────────────────────────────────────────
    // STEP 1: Queries with >= threshold total clicks
    //         Collect all productIds clicked per query
    // ─────────────────────────────────────────────────────────
    const queryClickData = await Analytics.aggregate([
      {
        $match: {
          store,
          type: "click",
          productId: { $exists: true, $ne: null },
          normalizedQuery: { $exists: true, $ne: "" },
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: "$normalizedQuery",
          totalClicks: { $sum: 1 },
          productIds:  { $addToSet: "$productId" }
        }
      },
      { $match: { totalClicks: { $gte: minClicks } } },
      { $sort: { totalClicks: -1 } },
      { $limit: 100 }
    ]);

    if (!queryClickData.length) {
      return res.json({
        detected: [],
        saved: [],
        total: 0,
        message: `No queries found with ${minClicks}+ clicks in last ${days} days`
      });
    }

    // ─────────────────────────────────────────────────────────
    // STEP 2: Fetch tags for all clicked products
    // ─────────────────────────────────────────────────────────
    const allProductIds = [...new Set(queryClickData.flatMap(q => q.productIds))];

    const productDocs = await Product.find({
      store,
      productId: { $in: allProductIds }
    }).select("productId tags").lean();

    const productTagMap = {};
    productDocs.forEach(p => {
      productTagMap[String(p.productId)] = (p.tags || []).map(t => t.toLowerCase().trim());
    });

    // ─────────────────────────────────────────────────────────
    // STEP 3: For each query, find tags that appear in >= 2
    //         distinct clicked products AND are NOT related
    //         to the query itself
    // ─────────────────────────────────────────────────────────
    const isRelatedToQuery = (word, queryTokens) =>
      queryTokens.some(qt =>
        word === qt ||
        word.includes(qt) ||
        qt.includes(word) ||
        // Prefix similarity: "kameez" / "kamees" → skip (same root)
        (word.length >= 4 && qt.length >= 4 && word.slice(0, 4) === qt.slice(0, 4))
      );

    const detected = [];

    for (const qData of queryClickData) {
      const query = qData._id;
      const queryTokens = query.split(/\s+/).filter(Boolean);

      // Count how many distinct products have each tag for this query
      const tagToProducts = {}; // tag → Set of productIds

      qData.productIds.forEach(productId => {
        const tags = productTagMap[String(productId)] || [];
        tags.forEach(tag => {
          if (!tag || tag.length < 3) return;
          if (isRelatedToQuery(tag, queryTokens)) return;

          if (!tagToProducts[tag]) tagToProducts[tag] = new Set();
          tagToProducts[tag].add(String(productId));
        });
      });

      // Keep only tags confirmed by >= 2 products
      const candidates = Object.entries(tagToProducts)
        .filter(([, pSet]) => pSet.size >= 2)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 5)
        .map(([word, pSet]) => ({
          word,
          supportingProducts: pSet.size,
          // Confidence = fraction of clicked products that have this tag (max 1.0)
          confidence: parseFloat(
            Math.min(pSet.size / Math.max(qData.productIds.length, 1), 1).toFixed(2)
          )
        }));

      if (candidates.length) {
        detected.push({
          query,
          totalClicks:    qData.totalClicks,
          clickedProducts: qData.productIds.length,
          candidates
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // STEP 4: Auto-save if requested
    //         Never overwrite existing manual (autoGenerated: false) words
    // ─────────────────────────────────────────────────────────
    const saved = [];

    if (autoSave && detected.length) {
      for (const item of detected) {
        const existing = await Synonym.findOne({ store, query: item.query }).lean();
        const existingWords = new Set((existing?.synonyms || []).map(s => s.word));

        // Only add words that don't already exist
        const newSynObjects = item.candidates
          .filter(c => !existingWords.has(c.word))
          .map(c => ({
            word:          c.word,
            usageCount:    c.supportingProducts,
            autoGenerated: true,
            confidence:    c.confidence
          }));

        if (!newSynObjects.length) continue;

        if (existing) {
          await Synonym.updateOne(
            { store, query: item.query },
            { $push: { synonyms: { $each: newSynObjects } } }
          );
        } else {
          await Synonym.create({ store, query: item.query, synonyms: newSynObjects });
        }

        saved.push({
          query:      item.query,
          addedWords: newSynObjects.map(w => w.word)
        });
      }
    }

    res.json({
      detected,
      saved:   autoSave ? saved : [],
      total:   detected.length,
      message: autoSave
        ? `${saved.length} synonym mapping(s) saved/updated`
        : `${detected.length} synonym candidate(s) found — pass autoSave: true to save them`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AI SETTINGS ADMIN CONTROL
// ============================================================

// GET /api/admin/ai-settings?shop=xxx
router.get("/admin/ai-settings", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    let settings = await Settings.findOne({ shop }).lean();
    if (!settings) settings = await Settings.create({ shop });
    res.json(settings?.aiSettings || { geminiEnabled: true, geminiModel: "llama-3.3-70b-versatile" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/ai-settings
// body: { shop, geminiEnabled, geminiModel, trendingCollectionsEnabled, suggestionsEnabled }
router.put("/admin/ai-settings", async (req, res) => {
  try {
    const { shop, geminiEnabled, geminiModel, trendingCollectionsEnabled, suggestionsEnabled } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const updates = {};
    if (geminiEnabled              !== undefined) updates["aiSettings.geminiEnabled"]              = Boolean(geminiEnabled);
    if (geminiModel                !== undefined) updates["aiSettings.geminiModel"]                = String(geminiModel);
    if (trendingCollectionsEnabled !== undefined) updates["aiSettings.trendingCollectionsEnabled"] = Boolean(trendingCollectionsEnabled);
    if (suggestionsEnabled         !== undefined) updates["aiSettings.suggestionsEnabled"]         = Boolean(suggestionsEnabled);

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: updates },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);
    res.json(settings?.aiSettings || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/suggestions
// Add a manual suggestion
// body: { shop, text }
router.post("/admin/suggestions", async (req, res) => {
  try {
    const { shop, text } = req.body;
    if (!shop || !text) return res.status(400).json({ error: "Shop and text required" });

    const cleaned = text.toLowerCase().trim();
    if (cleaned.length < 2 || cleaned.length > 80) {
      return res.status(400).json({ error: "Text must be 2-80 characters" });
    }

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $addToSet: { "aiSettings.manualSuggestions": cleaned } },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);
    res.json({ manualSuggestions: settings?.aiSettings?.manualSuggestions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/suggestions
// Remove a manual suggestion
// body: { shop, text }
router.delete("/admin/suggestions", async (req, res) => {
  try {
    const { shop, text } = req.body;
    if (!shop || !text) return res.status(400).json({ error: "Shop and text required" });

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $pull: { "aiSettings.manualSuggestions": text.toLowerCase().trim() } },
      { new: true }
    );
    searchRoute.clearSettingsCache(shop);
    res.json({ manualSuggestions: settings?.aiSettings?.manualSuggestions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/suggestions?shop=xxx
// List manual suggestions
router.get("/admin/suggestions", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const settings = await Settings.findOne({ shop }).lean();
    res.json({ manualSuggestions: settings?.aiSettings?.manualSuggestions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DISPLAY SETTINGS (public read + admin write)
// Controls what the storefront shows: trending collections, suggestions
// ============================================================

// GET /api/display-settings?store=xxx  — public (storefront reads this)
router.get("/display-settings", async (req, res) => {
  try {
    const shop = normalizeStoreDomain(req.query.store || req.query.shop || "");
    if (!shop) return res.status(400).json({ error: "store required" });

    const settings = await Settings.findOne({ shop }).lean();
    const ai = settings?.aiSettings || {};

    res.json({
      showTrendingCollections: ai.trendingCollectionsEnabled === true,
      showSuggestions:         ai.suggestionsEnabled !== false   // default true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/display-settings  — admin write
// body: { shop, showTrendingCollections, showSuggestions }
router.put("/admin/display-settings", async (req, res) => {
  try {
    const { shop, showTrendingCollections, showSuggestions } = req.body;
    if (!shop) return res.status(400).json({ error: "shop required" });

    const updates = {};
    if (showTrendingCollections !== undefined)
      updates["aiSettings.trendingCollectionsEnabled"] = Boolean(showTrendingCollections);
    if (showSuggestions !== undefined)
      updates["aiSettings.suggestionsEnabled"] = Boolean(showSuggestions);

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: updates },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);

    const ai = settings?.aiSettings || {};
    res.json({
      showTrendingCollections: ai.trendingCollectionsEnabled === true,
      showSuggestions:         ai.suggestionsEnabled !== false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FILTER CONFIG (admin)
// ============================================================

// GET /api/admin/filters?shop=xxx
// Returns current filter config for the store
router.get("/admin/filters", async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    let settings = await Settings.findOne({ shop }).lean();
    if (!settings) settings = await Settings.create({ shop });

    const filters = settings.filters || DEFAULT_FILTERS;
    res.json({
      ...DEFAULT_FILTERS,
      ...filters,
      active: (filters.active || DEFAULT_FILTERS.active).map(normalizeFilterKey)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/filters
// body: { shop, enabled?, active?: ["availability","vendor","collection","size","color","productType","price"], hideOutOfStock? }
router.put("/admin/filters", async (req, res) => {
  try {
    const { shop, enabled, active, hideOutOfStock } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    const updates = {};

    if (enabled !== undefined)        updates["filters.enabled"]        = Boolean(enabled);
    if (hideOutOfStock !== undefined) updates["filters.hideOutOfStock"] = Boolean(hideOutOfStock);
    if (Array.isArray(active)) {
      updates["filters.active"] = [...new Set(
        active
          .filter(f => ALLOWED_FILTERS.includes(f))
          .map(normalizeFilterKey)
      )];
    }

    const settings = await Settings.findOneAndUpdate(
      { shop },
      { $set: updates },
      { new: true, upsert: true }
    );
    searchRoute.clearSettingsCache(shop);
    res.json(settings.filters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/filter-options?shop=xxx
// Returns available filter values from the product DB for this store
// Used by storefront to populate filter dropdowns
router.get("/filter-options", async (req, res) => {
  try {
    const shop = normalizeStoreDomain(req.query.shop || req.query.store || "");
    if (!shop) return res.status(400).json({ error: "shop required" });

    const baseMatch = { store: shop, status: "ACTIVE" };
    const vendorFilter = req.query.vendor ? String(req.query.vendor).trim() : "";
    const scopedMatch = vendorFilter
      ? { ...baseMatch, vendor: { $regex: `^${vendorFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }
      : baseMatch;

    const [vendors, colors, sizes, collections, productTypes, priceRange, topTags, availability] = await Promise.all([
      // Distinct vendors (sorted alphabetically)
      Product.distinct("vendor", baseMatch).then(v =>
        v.filter(Boolean).sort((a, b) => a.localeCompare(b))
      ),

      // Distinct colors (flatten array field)
      Product.aggregate([
        { $match: scopedMatch },
        { $unwind: { path: "$colors", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$colors" } },
        { $sort: { _id: 1 } }
      ]).then(docs => docs.map(d => d._id).filter(Boolean)),

      Product.aggregate([
        { $match: scopedMatch },
        { $unwind: { path: "$sizes", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$sizes" } },
        { $sort: { _id: 1 } }
      ]).then(docs => docs.map(d => d._id).filter(Boolean)),

      Product.aggregate([
        { $match: scopedMatch },
        { $unwind: { path: "$collections", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$collections" } },
        { $sort: { _id: 1 } }
      ]).then(docs => docs.map(d => d._id).filter(Boolean)),

      Product.distinct("productType", scopedMatch).then(types =>
        types.filter(Boolean).sort((a, b) => a.localeCompare(b))
      ),

      // Price min / max
      Product.aggregate([
        { $match: { ...scopedMatch, price: { $gt: 0 } } },
        { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } }
      ]).then(docs => docs[0] ? { min: docs[0].min, max: docs[0].max } : { min: 0, max: 0 }),

      // Top 50 tags by frequency
      Product.aggregate([
        { $match: scopedMatch },
        { $unwind: { path: "$tags", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]).then(docs => docs.map(d => d._id).filter(Boolean)),

      Product.aggregate([
        { $match: scopedMatch },
        {
          $group: {
            _id: null,
            inStock: { $sum: { $cond: [{ $gt: ["$stock", 0] }, 1, 0] } },
            outOfStock: { $sum: { $cond: [{ $lte: ["$stock", 0] }, 1, 0] } }
          }
        }
      ]).then(docs => docs[0]
        ? { in_stock: docs[0].inStock, out_of_stock: docs[0].outOfStock }
        : { in_stock: 0, out_of_stock: 0 }
      )
    ]);

    const collectionIdsForLookup = [...new Set([
      ...collections.map(String),
      ...collections.map(normalizeCollectionId)
    ].filter(Boolean))];
    const collectionDocs = collectionIdsForLookup.length
      ? await Collection.find({ store: shop, collectionId: { $in: collectionIdsForLookup } })
        .select("collectionId title handle image")
        .lean()
      : [];
    const collectionMap = new Map();
    collectionDocs.forEach(c => {
      collectionMap.set(String(c.collectionId), c);
      collectionMap.set(normalizeCollectionId(c.collectionId), c);
    });
    const collectionOptions = collections.map(id => {
      const doc = collectionMap.get(String(id)) || collectionMap.get(normalizeCollectionId(id));
      return {
        id: String(id),
        title: doc?.title || String(id),
        handle: doc?.handle || "",
        image: doc?.image || ""
      };
    });

    res.json({
      availability,
      vendors,
      colors,
      sizes,
      collections,
      collectionOptions,
      productTypes,
      price: priceRange,
      tags: topTags
    });
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
