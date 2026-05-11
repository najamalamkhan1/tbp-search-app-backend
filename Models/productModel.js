const mongoose = require("mongoose");

const productSchema =
  new mongoose.Schema({

    store: {
      type: String,
      required: true,
      index: true
    },

    productId: {
      type: String,
      required: true
    },

    title: {
      type: String,
      default: ""
    },

    handle: {
      type: String,
      default: ""
    },

    vendor: {
      type: String,
      default: "",
      index: true
    },

    tags: {
      type: [String],
      default: []
    },

    image: {
      type: String,
      default: ""
    },

    price: {
      type: String,
      default: "0"
    },

    collections: {
      type: [String],
      default: []
    },

    status: {
      type: String,
      default: "ACTIVE",
      index: true
    },

    searchableText: {
      type: String,
      default: ""
    },

  }, {
    timestamps: true
  });

// 🔥 PREVENT DUPLICATES
productSchema.index({
  store: 1,
  productId: 1
}, {
  unique: true
});

// 🔥 TEXT SEARCH
productSchema.index({
  searchableText: "text"
});

// 🔥 FAST FILTERING
productSchema.index({
  store: 1,
  vendor: 1
});

module.exports =
  mongoose.model(
    "Product",
    productSchema
  );