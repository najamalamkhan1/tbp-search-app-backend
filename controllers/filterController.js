const mongoose = require("mongoose");
const Filter = require("../Models/Filter");
const Product = require("../Models/productModel");
const Collection = require("../Models/collectionModel");
const searchRoute = require("../Routes/search");

const {
  ALLOWED_FILTER_TYPES,
  ALLOWED_VISIBILITY,
  ALLOWED_STATUS
} = Filter;

const normalizeShop = (shop) =>
  String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const escapeRegex = (value) =>
  String(value || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const CANONICAL_COLORS = new Set([
  "black", "white", "red", "blue", "green", "yellow", "pink", "orange", "purple",
  "maroon", "navy", "grey", "gray", "beige", "cream", "golden", "gold", "silver",
  "nude", "ivory", "mint", "teal", "mustard", "burgundy", "olive", "rust", "coral",
  "peach", "lilac", "lavender", "rose", "brown", "tan", "blush", "turquoise",
  "magenta", "fuchsia", "emerald", "violet", "caramel", "charcoal", "champagne",
  "taupe"
]);

const COLOR_NORMALIZE = { gray: "grey", gold: "golden" };

const sendValidation = (res, errors) =>
  res.status(400).json({
    success: false,
    error: "Validation failed",
    errors
  });

const sanitizeSettings = (settings = {}) => {
  const sanitized = {};
  if (settings.enabled !== undefined) sanitized.enabled = Boolean(settings.enabled);
  if (settings.searchable !== undefined) sanitized.searchable = Boolean(settings.searchable);
  if (settings.multiSelect !== undefined) sanitized.multiSelect = Boolean(settings.multiSelect);
  if (settings.pinned !== undefined) sanitized.pinned = Boolean(settings.pinned);
  if (settings.group !== undefined) sanitized.group = String(settings.group || "").trim();
  if (settings.colorSwatches && typeof settings.colorSwatches === "object" && !Array.isArray(settings.colorSwatches)) {
    sanitized.colorSwatches = settings.colorSwatches;
  }
  return sanitized;
};

const sanitizeMetafield = (metafield = {}) => ({
  namespace: String(metafield.namespace || "").trim(),
  key: String(metafield.key || "").trim()
});

const validateCreatePayload = (body) => {
  const errors = {};
  const shop = normalizeShop(body.shop);
  const label = String(body.label || "").trim();
  const filterType = String(body.filterType || "").trim();
  const visibility = body.visibility === undefined ? "visible" : String(body.visibility).trim();
  const status = body.status === undefined ? "active" : String(body.status).trim();

  if (!shop) errors.shop = "shop is required";
  if (!label) errors.label = "label is required";
  if (!filterType) errors.filterType = "filterType is required";
  if (filterType && !ALLOWED_FILTER_TYPES.includes(filterType)) {
    errors.filterType = `filterType must be one of: ${ALLOWED_FILTER_TYPES.join(", ")}`;
  }
  if (!ALLOWED_VISIBILITY.includes(visibility)) {
    errors.visibility = "visibility must be visible or hidden";
  }
  if (!ALLOWED_STATUS.includes(status)) {
    errors.status = "status must be active or inactive";
  }

  const isMetafieldFilter = ["metafield_boolean", "metafield_text", "metafield_list"].includes(filterType);
  if (isMetafieldFilter) {
    const metafield = sanitizeMetafield(body.metafield || {});
    if (!metafield.namespace) errors["metafield.namespace"] = "metafield.namespace is required for metafield filters";
    if (!metafield.key) errors["metafield.key"] = "metafield.key is required for metafield filters";
  }

  return { errors, shop, label, filterType, visibility, status };
};

const validateUpdatePayload = (body) => {
  const errors = {};
  if (body.label !== undefined && !String(body.label || "").trim()) {
    errors.label = "label cannot be empty";
  }
  if (body.visibility !== undefined && !ALLOWED_VISIBILITY.includes(String(body.visibility))) {
    errors.visibility = "visibility must be visible or hidden";
  }
  if (body.status !== undefined && !ALLOWED_STATUS.includes(String(body.status))) {
    errors.status = "status must be active or inactive";
  }
  if (body.filterType !== undefined && !ALLOWED_FILTER_TYPES.includes(String(body.filterType))) {
    errors.filterType = `filterType must be one of: ${ALLOWED_FILTER_TYPES.join(", ")}`;
  }
  if (body.position !== undefined && !Number.isFinite(Number(body.position))) {
    errors.position = "position must be a number";
  }
  return errors;
};

const clearCaches = (shop) => {
  if (!shop) return;
  if (typeof searchRoute.clearSettingsCache === "function") searchRoute.clearSettingsCache(shop);
  if (typeof searchRoute.clearSearchCache === "function") searchRoute.clearSearchCache(shop);
};

exports.createFilter = async (req, res) => {
  try {
    const { errors, shop, label, filterType, visibility, status } = validateCreatePayload(req.body || {});
    if (Object.keys(errors).length) return sendValidation(res, errors);

    const nextPosition =
      req.body.position !== undefined
        ? Number(req.body.position)
        : ((await Filter.findOne({ shop }).sort({ position: -1 }).select("position").lean())?.position ?? -1) + 1;

    const filter = await Filter.create({
      shop,
      label,
      filterType,
      source: String(req.body.source || "").trim(),
      visibility,
      status,
      position: nextPosition,
      settings: {
        enabled: status === "active",
        searchable: false,
        multiSelect: true,
        ...sanitizeSettings(req.body.settings || {})
      },
      metafield: sanitizeMetafield(req.body.metafield || {})
    });

    clearCaches(shop);
    res.status(201).json({ success: true, filter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getFilters = async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) return sendValidation(res, { shop: "shop is required" });

    const query = { shop };
    if (req.query.status) query.status = String(req.query.status);
    if (req.query.visibility) query.visibility = String(req.query.visibility);
    if (req.query.public === "true") {
      query.status = "active";
      query.visibility = "visible";
      query["settings.enabled"] = true;
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      query.$or = [
        { label: { $regex: search, $options: "i" } },
        { filterType: { $regex: search, $options: "i" } },
        { source: { $regex: search, $options: "i" } },
        { "settings.group": { $regex: search, $options: "i" } }
      ];
    }

    const filters = await Filter.find(query).sort({ position: 1, createdAt: 1 }).lean();
    res.json({ success: true, filters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const normalizeSource = (filter = {}) =>
  String(filter.source || filter.metafield?.key || filter.label || filter.filterType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const sourceLooksLike = (filter, patterns) => {
  const source = normalizeSource(filter);
  const meta = `${filter.metafield?.namespace || ""}.${filter.metafield?.key || ""}`.toLowerCase();
  const label = String(filter.label || "").toLowerCase();
  return patterns.some((pattern) =>
    source.includes(pattern) ||
    meta.includes(pattern) ||
    label.includes(pattern)
  );
};

const distinctArrayValues = async (field, match) =>
  Product.aggregate([
    { $match: match },
    { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 }
      }
    },
    { $match: { _id: { $nin: [null, ""] } } },
    { $sort: { _id: 1 } }
  ]);

const distinctScalarValues = async (field, match) =>
  Product.aggregate([
    { $match: { ...match, [field]: { $exists: true, $nin: [null, ""] } } },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

const optionDocsToValues = (docs) =>
  docs.map((doc) => ({
    label: String(doc._id),
    value: String(doc._id),
    count: doc.count || 0
  }));

const getCollectionOptions = async (match, shop) => {
  const docs = await distinctArrayValues("collections", match);
  const ids = docs.map((doc) => String(doc._id));
  const normalizedIds = ids.map((id) => id.replace("gid://shopify/Collection/", ""));
  const lookupIds = [...new Set([...ids, ...normalizedIds].filter(Boolean))];
  const collections = lookupIds.length
    ? await Collection.find({ store: shop, collectionId: { $in: lookupIds } })
      .select("collectionId title handle image")
      .lean()
    : [];

  const map = new Map();
  collections.forEach((collection) => {
    map.set(String(collection.collectionId), collection);
    map.set(String(collection.collectionId).replace("gid://shopify/Collection/", ""), collection);
  });

  return docs.map((doc) => {
    const id = String(doc._id);
    const cleanId = id.replace("gid://shopify/Collection/", "");
    const collection = map.get(id) || map.get(cleanId);
    return {
      label: collection?.title || id,
      value: id,
      id,
      handle: collection?.handle || "",
      image: collection?.image || "",
      count: doc.count || 0
    };
  });
};

const getAvailabilityOptions = async (match) => {
  const docs = await Product.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        inStock: { $sum: { $cond: [{ $gt: ["$stock", 0] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $lte: ["$stock", 0] }, 1, 0] } }
      }
    }
  ]);
  const counts = docs[0] || { inStock: 0, outOfStock: 0 };
  return [
    { label: "In stock", value: "in_stock", count: counts.inStock || 0 },
    { label: "Out of stock", value: "out_of_stock", count: counts.outOfStock || 0 }
  ];
};

const getPriceRange = async (match) => {
  const docs = await Product.aggregate([
    { $match: { ...match, price: { $gt: 0 } } },
    { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } }
  ]);
  const range = docs[0] || { min: 0, max: 0 };
  return { min: range.min || 0, max: range.max || 0 };
};

const getColorOptions = async (match) => {
  const docs = await distinctArrayValues("colors", match);
  const counts = new Map();

  docs.forEach((doc) => {
    const raw = String(doc._id || "").toLowerCase();
    const tokens = raw.split(/[\s\-_/|,]+/).filter(Boolean);
    tokens.forEach((token) => {
      const color = COLOR_NORMALIZE[token] || token;
      if (!CANONICAL_COLORS.has(color)) return;
      counts.set(color, (counts.get(color) || 0) + (doc.count || 0));
    });
  });

  return Array.from(counts.entries())
    .map(([color, count]) => ({
      label: color,
      value: color,
      count
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

const getOptionsForFilter = async (filter, match, shop) => {
  if (filter.filterType === "availability" || sourceLooksLike(filter, ["availability", "stock"])) {
    return { kind: "availability", options: await getAvailabilityOptions(match) };
  }

  if (filter.filterType === "price" || sourceLooksLike(filter, ["price"])) {
    return { kind: "price", price: await getPriceRange(match), options: [] };
  }

  if (filter.filterType === "vendor" || sourceLooksLike(filter, ["vendor", "brand", "designer"])) {
    return { kind: "vendor", options: optionDocsToValues(await distinctScalarValues("vendor", match)) };
  }

  if (filter.filterType === "product_type" || sourceLooksLike(filter, ["product_type", "producttype", "type"])) {
    return { kind: "product_type", options: optionDocsToValues(await distinctScalarValues("productType", match)) };
  }

  if (filter.filterType === "collection" || sourceLooksLike(filter, ["collection"])) {
    return { kind: "collection", options: await getCollectionOptions(match, shop) };
  }

  if (filter.filterType === "variant_option" || sourceLooksLike(filter, ["size", "sizes", "variant_option"])) {
    return { kind: "variant_option", options: optionDocsToValues(await distinctArrayValues("sizes", match)) };
  }

  if (filter.filterType === "color_swatch" || sourceLooksLike(filter, ["color", "colour", "shade", "tone", "palette"])) {
    return { kind: "color_swatch", options: await getColorOptions(match) };
  }

  if (filter.filterType === "tag" || sourceLooksLike(filter, ["tag", "tags"])) {
    return { kind: "tag", options: optionDocsToValues(await distinctArrayValues("tags", match)) };
  }

  if (["metafield_boolean", "metafield_text", "metafield_list"].includes(filter.filterType)) {
    return { kind: filter.filterType, options: [] };
  }

  return { kind: filter.filterType, options: [] };
};

exports.getFilterOptions = async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) return sendValidation(res, { shop: "shop is required" });

    const baseMatch = { store: shop, status: "ACTIVE" };
    const vendor = String(req.query.vendor || "").trim();
    const match = vendor
      ? { ...baseMatch, vendor: { $regex: `^${escapeRegex(vendor)}$`, $options: "i" } }
      : baseMatch;

    const filters = await Filter.find({
      shop,
      status: "active",
      visibility: "visible",
      "settings.enabled": true
    }).sort({ position: 1, createdAt: 1 }).lean();

    const hydratedFilters = await Promise.all(filters.map(async (filter) => {
      const optionData = await getOptionsForFilter(filter, match, shop);
      return {
        ...filter,
        optionKind: optionData.kind,
        options: optionData.options || [],
        price: optionData.price || undefined
      };
    }));

    res.json({ success: true, filters: hydratedFilters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getFilter = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return sendValidation(res, { id: "invalid filter id" });
    const filter = await Filter.findById(req.params.id).lean();
    if (!filter) return res.status(404).json({ success: false, error: "Filter not found" });
    res.json({ success: true, filter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateFilter = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return sendValidation(res, { id: "invalid filter id" });
    const errors = validateUpdatePayload(req.body || {});
    if (Object.keys(errors).length) return sendValidation(res, errors);

    const updates = {};
    ["label", "filterType", "visibility", "status", "source"].forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = String(req.body[field]).trim();
    });
    if (req.body.position !== undefined) updates.position = Number(req.body.position);
    if (req.body.settings !== undefined) {
      Object.entries(sanitizeSettings(req.body.settings)).forEach(([key, value]) => {
        updates[`settings.${key}`] = value;
      });
    }
    if (req.body.status !== undefined && req.body.settings?.enabled === undefined) {
      updates["settings.enabled"] = String(req.body.status).trim() === "active";
    }
    if (req.body.metafield !== undefined) {
      const metafield = sanitizeMetafield(req.body.metafield);
      updates["metafield.namespace"] = metafield.namespace;
      updates["metafield.key"] = metafield.key;
    }

    const filter = await Filter.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!filter) return res.status(404).json({ success: false, error: "Filter not found" });
    clearCaches(filter.shop);
    res.json({ success: true, filter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteFilter = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return sendValidation(res, { id: "invalid filter id" });
    const filter = await Filter.findByIdAndDelete(req.params.id);
    if (!filter) return res.status(404).json({ success: false, error: "Filter not found" });
    clearCaches(filter.shop);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return sendValidation(res, { id: "invalid filter id" });
    const status = String(req.body.status || "").trim();
    if (!ALLOWED_STATUS.includes(status)) return sendValidation(res, { status: "status must be active or inactive" });

    const filter = await Filter.findByIdAndUpdate(
      req.params.id,
      { $set: { status, "settings.enabled": status === "active" } },
      { new: true, runValidators: true }
    );
    if (!filter) return res.status(404).json({ success: false, error: "Filter not found" });
    clearCaches(filter.shop);
    res.json({ success: true, filter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.toggleVisibility = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return sendValidation(res, { id: "invalid filter id" });
    const visibility = String(req.body.visibility || "").trim();
    if (!ALLOWED_VISIBILITY.includes(visibility)) return sendValidation(res, { visibility: "visibility must be visible or hidden" });

    const filter = await Filter.findByIdAndUpdate(
      req.params.id,
      { $set: { visibility } },
      { new: true, runValidators: true }
    );
    if (!filter) return res.status(404).json({ success: false, error: "Filter not found" });
    clearCaches(filter.shop);
    res.json({ success: true, filter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.reorderFilters = async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const errors = {};
    if (!shop) errors.shop = "shop is required";
    if (!items.length) errors.items = "items must be a non-empty array";

    const sanitizedItems = items.map((item, index) => ({
      id: String(item.id || ""),
      position: Number.isFinite(Number(item.position)) ? Number(item.position) : index
    }));
    const invalid = sanitizedItems.find((item) => !isObjectId(item.id));
    if (invalid) errors.items = "each item must include a valid id";
    if (Object.keys(errors).length) return sendValidation(res, errors);

    await Filter.bulkWrite(
      sanitizedItems.map((item) => ({
        updateOne: {
          filter: { _id: item.id, shop },
          update: { $set: { position: item.position } }
        }
      })),
      { ordered: false }
    );

    clearCaches(shop);
    const filters = await Filter.find({ shop }).sort({ position: 1, createdAt: 1 }).lean();
    res.json({ success: true, filters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.bulkDelete = async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(isObjectId) : [];
    if (!shop || !ids.length) return sendValidation(res, { ids: "shop and valid ids are required" });
    const result = await Filter.deleteMany({ shop, _id: { $in: ids } });
    clearCaches(shop);
    res.json({ success: true, deletedCount: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.bulkStatus = async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(isObjectId) : [];
    const status = String(req.body.status || "").trim();
    if (!shop || !ids.length) return sendValidation(res, { ids: "shop and valid ids are required" });
    if (!ALLOWED_STATUS.includes(status)) return sendValidation(res, { status: "status must be active or inactive" });

    const result = await Filter.updateMany(
      { shop, _id: { $in: ids } },
      { $set: { status, "settings.enabled": status === "active" } }
    );
    clearCaches(shop);
    res.json({ success: true, modifiedCount: result.modifiedCount || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
