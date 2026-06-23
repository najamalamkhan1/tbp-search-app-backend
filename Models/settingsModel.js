const mongoose = require('mongoose')
const SettingsSchema = new mongoose.Schema({
  shop:    { type: String, required: true, unique: true },
  country: { type: String, default: "Pakistan" },

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
    typoEnabled: { type: Boolean, default: true },
    typoSuggestionsEnabled: { type: Boolean, default: true },
    typoSuggestionsAiEnabled: { type: Boolean, default: true },
    defaultSort: {
      type: String,
      enum: ["relevance", "newest", "oldest", "price_asc", "price_desc"],
      default: "relevance"
    },
    synonymsEnabled: { type: Boolean, default: true },
    delay: { type: Number, default: 300 },
    maxResults: { type: Number, default: 20 }
  },

  filters: {
    enabled: { type: Boolean, default: true },
    active: {
      type: [String],
      default: ["availability", "vendor", "collection", "size", "color", "productType", "price"]
    },
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

  searchOptions: {
    searchInTitle:       { type: Boolean, default: true  },
    searchInDescription: { type: Boolean, default: false },
    searchInTags:        { type: Boolean, default: true  },
    searchInVendor:      { type: Boolean, default: true  },
    searchInVariants:    { type: Boolean, default: false },
    searchInCollections: { type: Boolean, default: true  }
  },

  aiSettings: {
    geminiEnabled:              { type: Boolean, default: true },
    geminiModel:                { type: String,  default: "llama-3.3-70b-versatile" },
    trendingCollectionsEnabled: { type: Boolean, default: false },
    suggestionsEnabled:         { type: Boolean, default: true },
    manualSuggestions:          [{ type: String }]
  },

  billing: {
    plan: { type: String, default: "free" },
    usage: { type: Number, default: 0 }
  }

}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);
