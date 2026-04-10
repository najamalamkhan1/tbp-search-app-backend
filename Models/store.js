const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true, // abc.myshopify.com
  },
  accessToken: {
    type: String,
    required: true, // shpat_xxx
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