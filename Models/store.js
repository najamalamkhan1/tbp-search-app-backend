const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema({
  storeUrl: {
    type: String,
    required: true,
    unique:true,
    trim: true,
  },
  token: {
    type: String,
    required: true,
    unique:true
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Store", storeSchema);