const mongoose = require("mongoose");

const collectionSchema =
  new mongoose.Schema({

    store: {
      type: String,
      required: true,
      index: true
    },

    collectionId: {
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

    image: {
      type: String,
      default: ""
    },

    productsCount: {
      type: Number,
      default: 0
    },

    searchableText: {
      type: String,
      default: ""
    }

  }, {
    timestamps: true
  });

// 🔥 UNIQUE
collectionSchema.index({
  store: 1,
  collectionId: 1
}, {
  unique: true
});

// 🔥 SEARCH
collectionSchema.index({
  searchableText: "text"
});

module.exports =
  mongoose.model(
    "Collection",
    collectionSchema
  );