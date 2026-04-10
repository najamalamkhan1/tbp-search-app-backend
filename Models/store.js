const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema({
  storeUrl: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  shopName: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Store", storeSchema);