const express = require("express");
const router = express.Router();

const Collection =
  require("../Models/collectionModel");

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

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

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

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      console.log(
        "✅ COLLECTION CREATED:",
        data.title
      );

      res.status(200).send("OK");

    } catch (err) {

      console.log(
        "COLLECTION CREATE ERROR:",
        err
      );

      res.status(500).send("ERROR");
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

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

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

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      console.log(
        "♻️ COLLECTION UPDATED:",
        data.title
      );

      res.status(200).send("OK");

    } catch (err) {

      console.log(
        "COLLECTION UPDATE ERROR:",
        err
      );

      res.status(500).send("ERROR");
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

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ];

      const data =
        JSON.parse(req.body.toString());

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

      console.log(
        "COLLECTION DELETE ERROR:",
        err
      );

      res.status(500).send("ERROR");
    }
  }
);

module.exports = router;