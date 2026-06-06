const mongoose = require("mongoose");

const trendingSettingsSchema = new mongoose.Schema(
  {
    store: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // Admin-pinned product IDs (always appear first in trending)
    pinnedProductIds: {
      type: [String],
      default: []
    },

    // Admin-pinned collection IDs (always appear first in trending collections)
    pinnedCollectionIds: {
      type: [String],
      default: []
    },

    // Admin-pinned brand names (always appear first in trending brands)
    pinnedBrandNames: {
      type: [String],
      default: []
    },

    // Analytics window in days for trending calculation (default 7 = rolling 7-day window)
    analyticsWindowDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 90
    },

    // Max trending products to return
    maxTrendingProducts: {
      type: Number,
      default: 12,
      min: 4,
      max: 50
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("TrendingSettings", trendingSettingsSchema);
