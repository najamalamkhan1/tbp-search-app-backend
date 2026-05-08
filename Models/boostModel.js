const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  query: String,
  productId: String,
  store: String
}, { timestamps: true });

module.exports = mongoose.model("Boost", schema);