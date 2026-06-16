const express = require("express");
const router = express.Router();
const Product = require("../Models/productModel");
const Store = require("../Models/store");

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
  'black','white','red','blue','green','yellow','pink','orange','purple',
  'maroon','navy','grey','gray','beige','cream','golden','gold','silver',
  'nude','ivory','mint','teal','mustard','burgundy','olive','rust','coral',
  'peach','lilac','lavender','rose','brown','tan','blush','turquoise',
  'magenta','fuchsia','emerald','violet','caramel','charcoal','champagne',
]);
const _WH_COLOR_NORM = { gray: 'grey', gold: 'golden' };

function extractWebhookColors({ options = [], tags = [], title = '' }) {
  const found = new Set();
  const add = (v) => {
    const c = (v || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (c.length > 1 && c !== 'default title' && c !== 'none') {
      found.add(_WH_COLOR_NORM[c] || c);
    }
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
    if (/^off[\s-]?white$/i.test(t))  add('off-white');
    if (/^sky[\s-]?blue$/i.test(t))   add('sky blue');
    if (/^navy[\s-]?blue$/i.test(t))  add('navy blue');
    if (/^rose[\s-]?gold$/i.test(t))  add('rose gold');
  });

  // From title
  const tl = (title || '').toLowerCase();
  tl.split(/[\s\-|_\/,\(\)]+/).forEach(w => { if (_COLOR_TAGS_WH.has(w)) add(w); });
  if (/off[\s-]?white/i.test(tl)) add('off-white');
  if (/navy[\s-]?blue/i.test(tl)) add('navy blue');
  if (/rose[\s-]?gold/i.test(tl)) add('rose gold');

  return [...found];
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

      const searchableText = `

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

          productType:
            product.product_type || "",

          tags:
            product.tags
              ? product.tags
                .split(",")
                .map(t => t.trim())
              : [],

          image:
            product.image?.src || "",

          price:
            Number(
              product.variants?.[0]
                ?.price || 0
            ),

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

      const searchableText = `

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

          productType:
            product.product_type || "",

          tags:
            product.tags
              ? product.tags
                .split(",")
                .map(t => t.trim())
              : [],

          image:
            product.image?.src || "",

          price:
            Number(
              product.variants?.[0]
                ?.price || 0
            ),

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
          new: true
        }
      );

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

module.exports = router;
