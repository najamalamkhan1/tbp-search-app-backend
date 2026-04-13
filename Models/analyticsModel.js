const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema({
  type: String, // search | click | no_result
  query: String,
  productId: String,
  store: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Analytics", analyticsSchema);