const mongoose = require("mongoose");

const featuredBrandSchema =
    new mongoose.Schema({

        title: String,

        priority: {
            type: Number,
            default: 0
        },

        active: {
            type: Boolean,
            default: true
        },

        image: String,
        store: {
            type: String,
            required: true,
            index: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }

    });

module.exports = mongoose.model("FeaturedBrand", featuredBrandSchema);