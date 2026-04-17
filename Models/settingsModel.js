const mongoose = require('mongoose')
const SettingsSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },

  searchSettings: {
    type: {
      type: String,
      enum: ["product", "collection", "article"],
      default: "product"
    },
    autocomplete: { type: Boolean, default: true },
    typoTolerance: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },
    delay: { type: Number, default: 300 },
    maxResults: { type: Number, default: 20 }
  },

  filters: {
    enabled: { type: Boolean, default: true },
    active: [{ type: String }], // ["price", "vendor"]
    hideOutOfStock: { type: Boolean, default: false }
  },

  searchControl: {
    weights: {
      title: { type: Number, default: 3 },
      tags: { type: Number, default: 2 },
      vendor: { type: Number, default: 1 }
    },
    synonyms: [{ type: String }], // ["shoe,sneaker"]
    stopWords: [{ type: String }]
  },

  billing: {
    plan: { type: String, default: "free" },
    usage: { type: Number, default: 0 }
  }

}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);