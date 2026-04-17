const express = require("express");
const router = express.Router();

const Product = require("../Models/productModel");
const verifyShopifyWebhook = require("../middleware/verifyShopifyWebhook");

router.post("/webhooks/products/create", verifyShopifyWebhook, async (req, res) => {
  const shop = req.headers["x-shopify-shop-domain"];
  const product = req.body;

  await Product.findOneAndUpdate(
    { productId: product.id, shop },
    {
      shop,
      productId: product.id,
      title: product.title,
      description: product.body_html,
      vendor: product.vendor,
      productType: product.product_type,
      tags: product.tags ? product.tags.split(",") : [],
      price: parseFloat(product.variants?.[0]?.price || 0),
      stock: product.variants?.[0]?.inventory_quantity || 0,
      image: product.image?.src
    },
    { upsert: true }
  );

  res.status(200).send("OK");
});

router.post("/webhooks/products/update", verifyShopifyWebhook, async (req, res) => {
  const shop = req.headers["x-shopify-shop-domain"];
  const product = req.body;

  await Product.findOneAndUpdate(
    { productId: product.id, shop },
    {
      shop,
      productId: product.id,
      title: product.title,
      description: product.body_html,
      vendor: product.vendor,
      productType: product.product_type,
      tags: product.tags ? product.tags.split(",") : [],
      price: parseFloat(product.variants?.[0]?.price || 0),
      stock: product.variants?.[0]?.inventory_quantity || 0,
      image: product.image?.src
    },
    { upsert: true }
  );

  res.status(200).send("OK");
});

router.post("/webhooks/products/delete", verifyShopifyWebhook, async (req, res) => {
  const shop = req.headers["x-shopify-shop-domain"];
  const product = req.body;

  await Product.findOneAndDelete({
    productId: product.id,
    shop
  });

  res.status(200).send("OK");
});

module.exports = router;