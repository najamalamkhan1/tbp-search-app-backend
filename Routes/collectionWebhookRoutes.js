const express = require("express");

const router = express.Router();

const Collection =
  require("../Models/collectionModel");

const verifyShopifyWebhook =
  require("../middleware/verifyShopifyWebhook");

// =====================================
// CREATE
// =====================================
router.post(
  "/collections/create",
  verifyShopifyWebhook,
  async (req, res) => {

    try {

      const data =
        JSON.parse(req.body.toString());

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

      await Collection.findOneAndUpdate(

        {
          collectionId:
            String(data.id),

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

          productsCount:
            data.products_count || 0,

          searchableText: `
            ${data.title}
            ${data.handle}
          `.toLowerCase()
        },

        {
          upsert: true,
          returnDocument: "after"
        }
      );

      console.log(
        "✅ COLLECTION CREATED:",
        data.title
      );

      res.status(200).send("OK");

    } catch (err) {

      console.log(err);

      res.status(500).send("ERROR");
    }
  }
);

// =====================================
// UPDATE
// =====================================
router.post(
  "/collections/update",
  verifyShopifyWebhook,
  async (req, res) => {

    try {

      const data =
        JSON.parse(req.body.toString());

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

      await Collection.findOneAndUpdate(

        {
          collectionId:
            String(data.id),

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

          productsCount:
            data.products_count || 0,

          searchableText: `
            ${data.title}
            ${data.handle}
          `.toLowerCase()
        },

        {
          upsert: true,
          returnDocument: "after"
        }
      );

      console.log(
        "✅ COLLECTION UPDATED:",
        data.title
      );

      res.status(200).send("OK");

    } catch (err) {

      console.log(err);

      res.status(500).send("ERROR");
    }
  }
);

// =====================================
// DELETE
// =====================================
router.post(
  "/collections/delete",
  verifyShopifyWebhook,
  async (req, res) => {

    try {

      const data =
        JSON.parse(req.body.toString());

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

      await Collection.findOneAndDelete({

        collectionId:
          String(data.id),

        store: shop
      });

      console.log(
        "🗑 COLLECTION DELETED:",
        data.id
      );

      res.status(200).send("OK");

    } catch (err) {

      console.log(err);

      res.status(500).send("ERROR");
    }
  }
);

module.exports = router;