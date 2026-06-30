const express = require("express");
const cors = require("cors");
const mongoose = require('mongoose')
require("dotenv").config();
const webhooks = require('./Routes/webhookRoutes');

const app = express();
app.disable("etag");

app.use("/webhooks",
  express.raw({
    type: "*/*"
  })
);
app.use(express.json());
app.use(cors({
  origin: function (origin, callback) {

    // Postman / server-to-server (no origin header)
    if (!origin) return callback(null, true);

    // Localhost — local development
    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    ) {
      return callback(null, true);
    }

    // Shopify ecosystem
    if (
      origin.endsWith(".myshopify.com") ||
      origin.includes("admin.shopify.com") ||
      origin.includes(".trycloudflare.com") ||
      origin.includes(".workers.dev") ||
      origin.includes("nainpreet.com")
    ) {
      return callback(null, true);
    }

    return callback(null, true);
  },

  credentials: true,
}));

// MongoDB Connection
mongoose.connect(
  process.env.MONGO_DB_URI
)
// database connect
const db = mongoose.connection;
db.on('error', (error) => {
  console.log("Error Occured", error);
});
db.once('connected', async () => {
  console.log('MongoDB connected');
  try {
    const Product = require('./Models/productModel');
    const col = Product.collection;
    const indexes = await col.indexes();

    // Drop ANY existing text index that doesn't have store+status prefix
    const badTextIndex = indexes.find(i => i.textIndexVersion && !i.key?.store);
    if (badTextIndex) {
      await col.dropIndex(badTextIndex.name);
      console.log('[Migration] Dropped old text index:', badTextIndex.name);
    }

    // Always ensure the correct compound text index exists
    const hasCorrectIndex = indexes.find(i => i.name === 'store_status_text_search');
    if (!hasCorrectIndex) {
      await col.createIndex(
        { store: 1, status: 1, title: 'text', vendor: 'text', searchableText: 'text' },
        { weights: { title: 10, vendor: 7, searchableText: 3 }, name: 'store_status_text_search' }
      );
      console.log('[Migration] Compound text index created ✓');
    } else {
      console.log('[Migration] Text index OK ✓');
    }
    const fastIndexes = [
      [{ store: 1, status: 1, colors: 1, firstPublishedAt: -1 }, { name: 'fast_color_search' }],
      [{ store: 1, status: 1, stock: 1, firstPublishedAt: -1 }, { name: 'fast_stock_search' }],
      [{ store: 1, status: 1, sizes: 1, firstPublishedAt: -1 }, { name: 'fast_size_search' }],
      [{ store: 1, status: 1, collections: 1, firstPublishedAt: -1 }, { name: 'fast_collection_search' }],
      [{ store: 1, status: 1, productType: 1, firstPublishedAt: -1 }, { name: 'fast_product_type_search' }],
      [{ store: 1, status: 1, tags: 1, firstPublishedAt: -1 }, { name: 'fast_tag_search' }],
      [{ store: 1, status: 1, vendor: 1, firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 }, { name: 'fast_vendor_newest' }]
    ];
    for (const [keys, options] of fastIndexes) {
      if (!indexes.find(i => i.name === options.name)) {
        await col.createIndex(keys, options);
        console.log('[Migration] Created index:', options.name);
      }
    }
  } catch (e) {
    console.error('[Migration] Error:', e.message);
  }
})

// Routes files import
const productsRoute = require("./Routes/productsRoute");
const searchRoute = require("./Routes/search");
const storesRoute = require('./Routes/storeRoute')
const analyticsRoute = require('./Routes/analyticsRoute')
const settingsRoute = require('./Routes/settingsRoute')
const authRoutes = require("./Routes/authRoutes");
const synonymRoutes = require("./Routes/synonymRoute");
const boostRoute = require("./Routes/boostRoute");
const collectionWebhookRoutes = require("./Routes/collectionWebhookRoutes");
const filterRoutes = require("./Routes/filterRoutes");


// routes
app.use("/api", searchRoute);
app.use("/api", storesRoute);
app.use('/api', analyticsRoute)
app.use('/api', settingsRoute)
app.use("/api/", productsRoute);
app.use("/webhooks", webhooks);
app.use("/webhooks", collectionWebhookRoutes);
app.use("/auth", authRoutes);
app.use("/api/synonyms", synonymRoutes);
app.use("/api/boost", boostRoute);
app.use("/api", filterRoutes);

app.get("/", (req, res) => {
  res.send("Backend Running Successfully✅");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
