const express = require("express");
const router = express.Router();

const Product = require("../Models/productModel");
const verifyShopifyWebhook = require("../middleware/verifyShopifyWebhook");

router.post("/products/create", verifyShopifyWebhook, async (req, res) => {
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

router.post("/products/update", verifyShopifyWebhook, async (req, res) => {

  let data;

  try {
    data = JSON.parse(req.body.toString());
  } catch (err) {
    return res.status(400).send("Invalid JSON");
  }

  console.log("🔥 WEBHOOK HIT:", data.title);

  const shop = req.headers["x-shopify-shop-domain"];

  await Product.findOneAndUpdate(
    { productId: data.id, shop },
    {
      shop,
      productId: data.id,
      title: data.title,
      description: data.body_html,
      vendor: data.vendor,
      productType: data.product_type,
      tags: data.tags ? data.tags.split(",") : [],
      price: parseFloat(data.variants?.[0]?.price || 0),
      stock: data.variants?.[0]?.inventory_quantity || 0,
      image: data.image?.src
    },
    { upsert: true }
  );

  res.status(200).send("OK");
});

router.post("/products/delete", verifyShopifyWebhook, async (req, res) => {
  const shop = req.headers["x-shopify-shop-domain"];
  const product = req.body;

  await Product.findOneAndDelete({
    productId: product.id,
    shop
  });

  res.status(200).send("OK");
});

module.exports = router;