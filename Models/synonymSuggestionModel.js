const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  store:    { type: String, required: true, index: true },
  query:    { type: String, required: true },
  count:    { type: Number, default: 1 },
  // pending → admin hasn't acted | approved → added to synonyms | rejected → ignored
  status:   { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  approvedAs: { type: String, default: null }, // which base query this was linked to
}, { timestamps: true });

schema.index({ store: 1, query: 1 }, { unique: true });
schema.index({ store: 1, status: 1, count: -1 });

module.exports = mongoose.model("SynonymSuggestion", schema);
