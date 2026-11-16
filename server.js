require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require('mongoose')

// Index builds are heavy on the shared M0 cluster; run scripts/create-indexes.js instead of building at startup.
mongoose.set("autoIndex", process.env.AUTO_INDEX === "true");

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
const db = mongoose.connection;
db.on('error', (error) => {
  console.error("MongoDB connection error:", error.message);
});
db.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

const connectToMongo = async () => {
  const mongoUri = process.env.MONGO_DB_URI;

  if (!mongoUri) {
    console.error('MONGO_DB_URI is not configured; retrying in 30 seconds');
    setTimeout(connectToMongo, 30000);
    return;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      socketTimeoutMS: 45000,
    });
  } catch (error) {
    console.error(`MongoDB initial connection failed: ${error.message}`);
    setTimeout(connectToMongo, 10000);
  }
};

connectToMongo();

db.once('connected', () => {
  console.log('MongoDB connected');
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
