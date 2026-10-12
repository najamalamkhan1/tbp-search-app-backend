const express = require("express");
const router = express.Router();
const Product = require("../Models/productModel");
const Store = require("../Models/store");
const searchRoute = require("./search");
const { normalizeSearchText, normalizeTag } = require("../utils/searchRanking");
const fetch = require("node-fetch");

router.use((req, res, next) => {

  console.log(
    "🔥 WEBHOOK ROUTE HIT:",
    req.path
  );

  next();
});
const verifyShopifyWebhook =
  require("../middleware/verifyShopifyWebhook");

const _COLOR_TAGS_WH = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'orange', 'purple',
  'maroon', 'navy', 'grey', 'gray', 'beige', 'cream', 'golden', 'gold', 'silver',
  'nude', 'ivory', 'mint', 'teal', 'mustard', 'burgundy', 'olive', 'rust', 'coral',
  'peach', 'lilac', 'lavender', 'rose', 'brown', 'tan', 'blush', 'turquoise',
  'magenta', 'fuchsia', 'emerald', 'violet', 'caramel', 'charcoal', 'champagne', 'taupe',
]);
const _WH_COLOR_NORM = { gray: 'grey', gold: 'golden' };
const _WH_COMPOUND_COLOR_NORM = {
  'off white': 'off-white',
  'off-white': 'off-white',
  offwhite: 'off-white',
  'sky blue': 'sky blue',
  'sky-blue': 'sky blue',
  skyblue: 'sky blue',
  'navy blue': 'navy blue',
  'navy-blue': 'navy blue',
  navyblue: 'navy blue',
  'rose gold': 'rose gold',
  'rose-gold': 'rose gold',
  rosegold: 'rose gold',
  'dark green': 'dark green',
  'dark-green': 'dark green',
  darkgreen: 'dark green',
  'dark blue': 'dark blue',
  'dark-blue': 'dark blue',
  darkblue: 'dark blue',
};

function extractWebhookColors({ options = [], tags = [], title = '' }) {
  const found = new Set();
  const add = (v) => {
    const c = (v || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (c.length <= 1 || c === 'default title' || c === 'none') return;
    if (/https?:|www\.|cdn\.|gid:|shopify|metaobject|\.com|\.webp|\.png|\.jpe?g|^\d+$/.test(c)) return;

    const normalized = _WH_COMPOUND_COLOR_NORM[c] || _WH_COLOR_NORM[c] || c;
    if (_WH_COMPOUND_COLOR_NORM[c]) {
      found.add(normalized);
      return;
    }
    if (_COLOR_TAGS_WH.has(normalized)) {
      found.add(normalized);
      return;
    }

    const tokens = normalized.split(/[\s\-_/|,]+/).filter(Boolean);
    const colorTokens = tokens
      .map(t => _WH_COLOR_NORM[t] || t)
      .filter(t => _COLOR_TAGS_WH.has(t));
    colorTokens.forEach(t => found.add(t));
    if (colorTokens.length && tokens.length <= 4 && normalized.length <= 40) found.add(normalized);
  };

  // From product.options (Color/Colour option)
  (options || []).forEach(opt => {
    if (/^colou?r$/i.test(opt.name)) {
      (opt.values || []).forEach(v => add(v));
    }
  });

  // From tags
  (tags || []).forEach(tag => {
    const t = tag.toLowerCase().trim();
    if (_COLOR_TAGS_WH.has(t)) add(t);
    if (/^off[\s-]?white$/i.test(t)) add('off-white');
    if (/^sky[\s-]?blue$/i.test(t)) add('sky blue');
    if (/^navy[\s-]?blue$/i.test(t)) add('navy blue');
    if (/^rose[\s-]?gold$/i.test(t)) add('rose gold');
  });

  // From title
  const tl = (title || '').toLowerCase();
  tl.split(/[\s\-|_\/,\(\)]+/).forEach(w => { if (_COLOR_TAGS_WH.has(w)) add(w); });
  if (/off[\s-]?white/i.test(tl)) add('off-white');
  if (/navy[\s-]?blue/i.test(tl)) add('navy blue');
  if (/rose[\s-]?gold/i.test(tl)) add('rose gold');

  return [...found];
}

function extractWebhookSizes({ options = [], variants = [], tags = [] }) {
  const found = new Set();
  const add = (v) => {
    const size = String(v || '').trim();
    if (!size || /^default title$/i.test(size) || /^none$/i.test(size)) return;
    found.add(size);
  };

  (options || []).forEach(opt => {
    if (/^(size|sizes)$/i.test(opt.name || "")) {
      (opt.values || []).forEach(v => add(v));
    }
  });

  (variants || []).forEach(variant => {
    ["option1", "option2", "option3"].forEach(key => {
      const value = variant?.[key];
      if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large|extra small|extra large)$/i.test(String(value || ""))) {
        add(value);
      }
    });
  });

  (tags || []).forEach(tag => {
    const t = String(tag || '').trim();
    if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large|extra small|extra large)$/i.test(t)) add(t);
    const prefixed = t.match(/^size[:\s_-]+(.+)$/i);
    if (prefixed) add(prefixed[1]);
  });

  return [...found];
}

function sumWebhookStock(variants = []) {
  return (variants || []).reduce((total, variant) =>
    total + Math.max(Number(variant?.inventory_quantity || 0), 0), 0
  );
}

const inventoryItemIdValues = (id) => {
  const plainId = String(id || "").replace(/^gid:\/\/shopify\/InventoryItem\//, "").trim();
  return [...new Set([
    plainId,
    plainId ? `gid://shopify/InventoryItem/${plainId}` : ""
  ].filter(Boolean))];
};

function buildWebhookInventory(product = {}) {
  const variantsInventory = (product.variants || [])
    .map(variant => {
      const inventoryItemId = String(variant?.inventory_item_id || "").trim();
      return {
        variantId: String(variant?.id || ""),
        inventoryItemId,
        quantity: Math.max(Number(variant?.inventory_quantity || 0), 0),
        availableForSale:
          Number(variant?.inventory_quantity || 0) > 0 ||
          String(variant?.inventory_policy || "").toLowerCase() === "continue",
        inventoryPolicy: String(variant?.inventory_policy || "").toUpperCase()
      };
    })
    .filter(item => item.inventoryItemId);

  const inventoryItemIds = [...new Set(
    variantsInventory.flatMap(item => inventoryItemIdValues(item.inventoryItemId))
  )];
  const stock = variantsInventory.reduce((total, item) => total + Math.max(Number(item.quantity || 0), 0), 0);
  const availableForSale = Boolean(product.published_at) && (
    stock > 0 ||
    variantsInventory.some(item => item.availableForSale || item.inventoryPolicy === "CONTINUE")
  );

  return { variantsInventory, inventoryItemIds, stock, availableForSale };
}

// =====================================
// CREATE PRODUCT
// =====================================
router.post(
  "/products/create",

  verifyShopifyWebhook,

  async (req, res) => {

    try {
      if (!res.headersSent) {
        res.status(200).send("OK");
      }

      const product =
        JSON.parse(
          req.body.toString()
        );

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const store =
        await Store.findOne({
          domain: shop
        });

      if (!store) {

        console.log(
          "❌ Store not found:",
          shop
        );

        return;
      }

      let searchableText = `

${product.title || ""}

${product.vendor || ""}

${product.product_type || ""}

${product.tags || ""}

      `.toLowerCase();

      const webhookColors = extractWebhookColors({
        options: product.options || [],
        tags: product.tags ? product.tags.split(",").map(t => t.trim()) : [],
        title: product.title || ''
      });
      const webhookTags = product.tags ? product.tags.split(",").map(t => t.trim()) : [];
      const webhookSizes = extractWebhookSizes({
        options: product.options || [],
        variants: product.variants || [],
        tags: webhookTags
      });
      const webhookInventory = buildWebhookInventory(product);
      const webhookStock = webhookInventory.stock || sumWebhookStock(product.variants || []);
      searchableText = [
        product.title || "",
        product.vendor || "",
        product.product_type || "",
        webhookTags.join(" "),
        webhookColors.join(" "),
        webhookSizes.join(" ")
      ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();

      await Product.findOneAndUpdate(

        {
          productId:
            String(product.id),

          store: shop
        },

        {
          store: shop,

          productId:
            String(product.id),

          title:
            product.title || "",

          handle:
            product.handle || "",

          description:
            String(
              product.body_html || ""
            )
              .replace(/<[^>]*>/g, "")
              .slice(0, 2000),

          vendor:
            product.vendor || "",

          normalizedVendor: normalizeSearchText(product.vendor),

          productType:
            product.product_type || "",

          tags:
            webhookTags,

          normalizedTags: webhookTags.map(normalizeTag).filter(Boolean),

          image:
            product.image?.src || "",

          price:
            Number(
              product.variants?.[0]
                ?.price || 0
            ),

          stock: webhookStock,

          availableForSale: webhookInventory.availableForSale,

          inventoryItemIds: webhookInventory.inventoryItemIds,

          variantsInventory: webhookInventory.variantsInventory,

          sizes: webhookSizes,

          status:
            product.published_at
              ? (
                product.status ||
                "active"
              ).toUpperCase()
              : "UNPUBLISHED",

          publishedAt:
            product.published_at
              ? new Date(product.published_at)
              : null,

          shopifyPublishedAt:
            product.published_at
              ? new Date(product.published_at)
              : null,

          shopifyCreatedAt:
            product.created_at
              ? new Date(product.created_at)
              : null,

          // CREATE route mein — pehli publish date, hamesha set hoti hai
          firstPublishedAt:
            product.published_at
              ? new Date(product.published_at)
              : null,

          shopifyUpdatedAt:
            product.updated_at
              ? new Date(product.updated_at)
              : null,

          searchableText,

          colors: webhookColors,

          updatedAt:
            new Date()
        },

        {
          upsert: true,
          returnDocument: "after"
        }
      );
      searchRoute.clearTrendingCache(shop);
      searchRoute.clearSearchCache(shop);

      console.log(
        "✅ PRODUCT CREATED:",
        product.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "CREATE WEBHOOK ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("Error");
      }
    }
  }
);

// =====================================
// UPDATE PRODUCT
// =====================================
router.post(
  "/products/update",

  verifyShopifyWebhook,

  async (req, res) => {

    try {
      if (!res.headersSent) {
        res.status(200).send("OK");
      }

      const product =
        JSON.parse(
          req.body.toString()
        );

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const store =
        await Store.findOne({
          domain: shop
        });

      if (!store) {

        console.log(
          "❌ Store not found:",
          shop
        );

        return;
      }

      let searchableText = `

${product.title || ""}

${product.vendor || ""}

${product.product_type || ""}

${product.tags || ""}

      `.toLowerCase();

      const webhookColors = extractWebhookColors({
        options: product.options || [],
        tags: product.tags ? product.tags.split(",").map(t => t.trim()) : [],
        title: product.title || ''
      });
      const webhookTags = product.tags ? product.tags.split(",").map(t => t.trim()) : [];
      const webhookSizes = extractWebhookSizes({
        options: product.options || [],
        variants: product.variants || [],
        tags: webhookTags
      });
      const webhookInventory = buildWebhookInventory(product);
      const webhookStock = webhookInventory.stock || sumWebhookStock(product.variants || []);
      searchableText = [
        product.title || "",
        product.vendor || "",
        product.product_type || "",
        webhookTags.join(" "),
        webhookColors.join(" "),
        webhookSizes.join(" ")
      ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();

      // $set aur $setOnInsert alag karo:
      const existingProduct = await Product.findOne({
        productId: String(product.id),
        store: shop
      });

      const updateFields = {
        store: shop,
        productId: String(product.id),
        title: product.title || "",
        handle: product.handle || "",
        description: String(product.body_html || "").replace(/<[^>]*>/g, "").slice(0, 2000),
        vendor: product.vendor || "",
        normalizedVendor: normalizeSearchText(product.vendor),
        productType: product.product_type || "",
        tags: webhookTags,
        normalizedTags: webhookTags.map(normalizeTag).filter(Boolean),
        image: product.image?.src || "",
        price: Number(product.variants?.[0]?.price || 0),
        stock: webhookStock,
        availableForSale: webhookInventory.availableForSale,
        inventoryItemIds: webhookInventory.inventoryItemIds,
        variantsInventory: webhookInventory.variantsInventory,
        sizes: webhookSizes,
        status: product.published_at
          ? (product.status || "active").toUpperCase()
          : "UNPUBLISHED",
        publishedAt: product.published_at ? new Date(product.published_at) : null,
        shopifyPublishedAt: product.published_at ? new Date(product.published_at) : null,
        shopifyCreatedAt: product.created_at ? new Date(product.created_at) : null,
        shopifyUpdatedAt: product.updated_at ? new Date(product.updated_at) : null,
        searchableText,
        colors: webhookColors,
        updatedAt: new Date(),
      };

      // firstPublishedAt sirf tab set karo jab pehle kabhi set nahi hua
      if (!existingProduct?.firstPublishedAt && product.published_at) {
        updateFields.firstPublishedAt = new Date(product.published_at);
      }

      await Product.findOneAndUpdate(
        { productId: String(product.id), store: shop },
        { $set: updateFields },
        { upsert: true, new: true }
      );
      searchRoute.clearTrendingCache(shop);
      searchRoute.clearSearchCache(shop);

      console.log(
        "♻️ PRODUCT UPDATED:",
        product.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "UPDATE WEBHOOK ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("Error");
      }
    }
  }
);

// =====================================
// DELETE PRODUCT
// =====================================
router.post(
  "/products/delete",

  verifyShopifyWebhook,

  async (req, res) => {

    try {
      if (!res.headersSent) {
        res.status(200).send("OK");
      }

      const product =
        JSON.parse(
          req.body.toString()
        );

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      await Product.findOneAndDelete({

        productId:
          String(product.id),

        store: shop
      });
      searchRoute.clearTrendingCache(shop);
      searchRoute.clearSearchCache(shop);

      console.log(
        "🗑️ PRODUCT DELETED:",
        product.id
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "DELETE WEBHOOK ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("Error");
      }
    }
  }
);

async function fetchInventoryItemAvailable({ shop, accessToken, inventoryItemId }) {
  const plainId = String(inventoryItemId || "").replace(/^gid:\/\/shopify\/InventoryItem\//, "").trim();
  if (!plainId) return null;

  const response = await fetch(
    `https://${shop}/admin/api/2026-04/inventory_levels.json?inventory_item_ids=${encodeURIComponent(plainId)}`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Inventory levels fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const levels = Array.isArray(data?.inventory_levels) ? data.inventory_levels : [];
  return levels.reduce((total, level) => total + Math.max(Number(level?.available || 0), 0), 0);
}

async function recomputeProductStock(product) {
  const variantsInventory = Array.isArray(product.variantsInventory)
    ? product.variantsInventory
    : [];
  const stock = variantsInventory.reduce((total, item) =>
    total + Math.max(Number(item?.quantity || 0), 0), 0
  );
  const availableForSale = stock > 0 || variantsInventory.some(item =>
    item?.availableForSale === true ||
    String(item?.inventoryPolicy || "").toUpperCase() === "CONTINUE"
  );

  await Product.updateOne(
    { _id: product._id },
    {
      $set: {
        stock,
        availableForSale,
        variantsInventory,
        updatedAt: new Date()
      }
    }
  );
}

// =====================================
// LIVE INVENTORY UPDATE
// =====================================
router.post(
  "/inventory_levels/update",
  verifyShopifyWebhook,
  async (req, res) => {
    try {
      if (!res.headersSent) {
        res.status(200).send("OK");
      }

      const payload = JSON.parse(req.body.toString());
      const shop = req.headers["x-shopify-shop-domain"]?.trim()?.toLowerCase();
      const inventoryItemId = String(payload.inventory_item_id || "").trim();
      if (!shop || !inventoryItemId) return;

      const store = await Store.findOne({ domain: shop }).lean();
      let liveAvailable = Math.max(Number(payload.available || 0), 0);
      if (store?.accessToken) {
        try {
          liveAvailable = await fetchInventoryItemAvailable({
            shop,
            accessToken: store.accessToken,
            inventoryItemId
          });
        } catch (fetchErr) {
          console.warn("INVENTORY LEVEL FETCH FALLBACK:", fetchErr.message);
        }
      }
      const quantity = Math.max(Number(liveAvailable ?? payload.available ?? 0), 0);
      const ids = inventoryItemIdValues(inventoryItemId);

      const products = await Product.find({
        store: shop,
        inventoryItemIds: { $in: ids }
      }).select("_id variantsInventory").lean();

      for (const product of products) {
        const variantsInventory = (product.variantsInventory || []).map(item => {
          const itemIds = inventoryItemIdValues(item.inventoryItemId);
          if (!itemIds.some(id => ids.includes(id))) return item;
          return {
            ...item,
            quantity,
            availableForSale: quantity > 0 || String(item.inventoryPolicy || "").toUpperCase() === "CONTINUE"
          };
        });

        await recomputeProductStock({ ...product, variantsInventory });
      }

      searchRoute.clearSearchCache(shop);
      searchRoute.clearTrendingCache(shop);

      console.log(
        "INVENTORY UPDATED:",
        inventoryItemId,
        "qty=",
        quantity,
        "products=",
        products.length
      );
    } catch (err) {
      console.log("INVENTORY WEBHOOK ERROR:", err);
      if (!res.headersSent) {
        res.status(500).send("Error");
      }
    }
  }
);

module.exports = router;
