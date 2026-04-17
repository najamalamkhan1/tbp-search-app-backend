const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const Settings = require("../Models/settingsModel");
const Product = require("../Models/productModel");
const verifyWebhook = require('../middleware/verifyShopifyWebhook')


// 🔄 SYNC PRODUCTS (Fetch version)
router.post("/sync-products", async (req, res) => {
  try {
    const { shop, accessToken } = req.body;

    if (!shop || !accessToken) {
      return res.status(400).json({ error: "Shop & accessToken required" });
    }

    // ✅ FETCH (axios ki jagah)
    const response = await fetch(
      `https://${shop}/admin/api/2023-10/products.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();
    const products = data.products || [];

    // ✅ Format data
    const formatted = products.map(p => ({
      shop,
      productId: p.id,
      title: p.title,
      description: p.body_html,
      vendor: p.vendor,
      productType: p.product_type,
      tags: p.tags ? p.tags.split(",") : [],
      price: parseFloat(p.variants?.[0]?.price || 0),
      stock: p.variants?.[0]?.inventory_quantity || 0,
      image: p.image?.src
    }));

    // ✅ Old products delete (optional but recommended)
    await Product.deleteMany({ shop });

    // ✅ Insert new
    await Product.insertMany(formatted);

    res.json({
      success: true,
      count: formatted.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Sync failed" });
  }
});

module.exports = router;