const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    shop: { type: String, required: true },
    productId: String,
    title: String,
    description: String,
    vendor: String,
    productType: String,
    tags: [String],
    price: Number,
    stock: Number,
    image: String,
}, { timestamps: true });

// ✅ TEXT SEARCH INDEX
productSchema.index({
    title: "text",
    description: "text",
    tags: "text",
    vendor: "text"
});

module.exports = mongoose.model("Product", productSchema);