const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema({
  storeName: String,
  domain: String, // example: abc-store.myshopify.com
  accessToken: String,
  required:true,
  new:true,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Store", storeSchema);