const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  productId: String,
  query: String,
  store: String,
  count: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model("Click", schema);