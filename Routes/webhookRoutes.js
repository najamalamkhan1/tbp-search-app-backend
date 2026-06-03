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
