const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  query: String,
  synonyms: [String],
  store: String,
}, { timestamps: true });

module.exports = mongoose.model("Synonym", schema);