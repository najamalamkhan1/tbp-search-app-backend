const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true,
    unique: true, // 🔥 IMPORTANT
  },
  accessToken: {
    type: String,
    required: true,
  },
  shopName: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Store", storeSchema);