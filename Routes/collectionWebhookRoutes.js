const express = require("express");
const router = express.Router();

const Collection =
  require("../Models/collectionModel");

const searchRoute =
  require("./search");

const verifyShopifyWebhook =
  require("../middleware/verifyShopifyWebhook");

// =====================================
// CREATE COLLECTION
// =====================================
router.post(
  "/collections/create",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndUpdate(

        {
          collectionId: String(data.id),
          store: shop
        },

        {
          store: shop,

          collectionId:
            String(data.id),

          title:
            data.title || "",

          handle:
            data.handle || "",

          image:
            data.image?.src || "",

          description:
            String(
              data.body_html || ""
            )
              .replace(/<[^>]*>/g, "")
              .slice(0, 2000),

          productsCount:
            Number(
              data.products_count || 0
            ),

          shopifyCreatedAt:
            data.created_at
              ? new Date(data.created_at)
              : null,

          shopifyPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : null,

          firstPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : (
                data.created_at
                  ? new Date(data.created_at)
                  : null
              ),

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
            ${data.body_html || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);

      console.log(
        "✅ COLLECTION CREATED:",
        data.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION CREATE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

// =====================================
// UPDATE COLLECTION
// =====================================
router.post(
  "/collections/update",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndUpdate(

        {
          collectionId: String(data.id),
          store: shop
        },

        {
          store: shop,

          collectionId:
            String(data.id),

          title:
            data.title || "",

          handle:
            data.handle || "",

          image:
            data.image?.src || "",

          description:
            String(
              data.body_html || ""
            )
              .replace(/<[^>]*>/g, "")
              .slice(0, 2000),

          productsCount:
            Number(
              data.products_count || 0
            ),

          shopifyCreatedAt:
            data.created_at
              ? new Date(data.created_at)
              : null,

          shopifyPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : null,

          firstPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : (
                data.created_at
                  ? new Date(data.created_at)
                  : null
              ),

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
            ${data.body_html || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);

      console.log(
        "♻️ COLLECTION UPDATED:",
        data.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION UPDATE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

// =====================================
// DELETE COLLECTION
// =====================================
router.post(
  "/collections/delete",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndDelete({

        collectionId:
          String(data.id),

        store: shop
      });

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);

      console.log(
        "🗑 COLLECTION DELETED:",
        data.id
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION DELETE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

module.exports = router;
