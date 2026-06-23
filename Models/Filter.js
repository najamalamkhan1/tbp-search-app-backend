const mongoose = require("mongoose");

const ALLOWED_FILTER_TYPES = [
  "availability",
  "price",
  "product_type",
  "vendor",
  "tag",
  "collection",
  "variant_option",
  "color_swatch",
  "metafield_boolean",
  "metafield_text",
  "metafield_list"
];

const ALLOWED_VISIBILITY = ["visible", "hidden"];
const ALLOWED_STATUS = ["active", "inactive"];

const filterSchema = new mongoose.Schema(
  {
    shop: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    filterType: {
      type: String,
      required: true,
      enum: ALLOWED_FILTER_TYPES
    },
    source: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200
    },
    visibility: {
      type: String,
      enum: ALLOWED_VISIBILITY,
      default: "visible"
    },
    status: {
      type: String,
      enum: ALLOWED_STATUS,
      default: "active"
    },
    position: {
      type: Number,
      default: 0,
      index: true
    },
    settings: {
      enabled: { type: Boolean, default: true },
      searchable: { type: Boolean, default: false },
      multiSelect: { type: Boolean, default: true },
      pinned: { type: Boolean, default: false },
      colorSwatches: {
        type: Map,
        of: String,
        default: undefined
      },
      group: {
        type: String,
        default: "",
        trim: true
      }
    },
    metafield: {
      namespace: { type: String, default: "", trim: true },
      key: { type: String, default: "", trim: true }
    }
  },
  { timestamps: true }
);

filterSchema.index({ shop: 1, position: 1 });
filterSchema.index({ shop: 1, filterType: 1 });
filterSchema.index({ shop: 1, status: 1, visibility: 1 });

module.exports = mongoose.model("Filter", filterSchema);
module.exports.ALLOWED_FILTER_TYPES = ALLOWED_FILTER_TYPES;
module.exports.ALLOWED_VISIBILITY = ALLOWED_VISIBILITY;
module.exports.ALLOWED_STATUS = ALLOWED_STATUS;
