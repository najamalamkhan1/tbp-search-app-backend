/**
 * Shopify GraphQL fallback.
 *
 * MongoDB stays the primary source for search + trending. This module is only
 * used when Mongo returns 0 products or errors out, so storefront results are
 * never empty. It is intentionally defensive:
 *   - hard timeout per request
 *   - per-shop circuit breaker (3 failures -> 60s pause)
 *   - small in-memory cache
 *   - env kill switch: SHOPIFY_FALLBACK_ENABLED=false
 *
 * Results are mapped to the same shape as Models/productModel.js so the
 * existing ranking / pagination code can consume them unchanged.
 */

const stringSimilarity = require("string-similarity");
const Store = require("../Models/store");
const {
  calculateMatchPriority,
  normalizeSearchText,
  productIsAvailable,
  resolveVendor,
} = require("./searchRanking");

const API_VERSION = "2026-04";
const REQUEST_TIMEOUT_MS = 2000;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60 * 1000;
const RESULT_CACHE_TTL_MS = 60 * 1000;
const RESULT_CACHE_MAX = 200;
const VENDOR_CACHE_TTL_MS = 15 * 60 * 1000;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CANDIDATE_LIMIT = 100;

const PRODUCT_FIELDS = `
  id
  title
  handle
  vendor
  productType
  tags
  status
  createdAt
  publishedAt
  totalInventory
  tracksInventory
  featuredImage { url }
  variants(first: 1) { edges { node { price } } }
`;

// ---------------------------------------------------------------------------
// injectable dependencies (tests)
// ---------------------------------------------------------------------------
let fetchImpl = null;
const getFetch = () => {
  if (fetchImpl) return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return require("node-fetch");
};

const normalizeShopDomain = (shop) =>
  String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

const escapeRegex = (value) => String(value).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

let storeLookup = async (shop) =>
  Store.findOne({
    domain: { $regex: new RegExp(`^(https?://)?(www\\.)?${escapeRegex(shop)}/?$`, "i") },
  })
    .select("domain accessToken")
    .lean()
    .maxTimeMS(1000);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const tokenCache = new Map(); // shop -> { token, domain, ts }
const breaker = new Map(); // shop -> { failures, openUntil }
const resultCache = new Map(); // key -> { data, ts }
const vendorCache = new Map(); // shop -> { data, ts }

const isEnabled = () => String(process.env.SHOPIFY_FALLBACK_ENABLED || "").toLowerCase() !== "false";

const breakerOpen = (shop) => {
  const state = breaker.get(shop);
  return Boolean(state && state.openUntil && state.openUntil > Date.now());
};
const recordFailure = (shop) => {
  const state = breaker.get(shop) || { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    state.failures = 0;
    console.warn(`[FALLBACK] circuit open for ${shop} (${BREAKER_COOLDOWN_MS / 1000}s)`);
  }
  breaker.set(shop, state);
};
const recordSuccess = (shop) => {
  breaker.set(shop, { failures: 0, openUntil: 0 });
};

const cacheGet = (key) => {
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.ts < RESULT_CACHE_TTL_MS) return hit.data;
  if (hit) resultCache.delete(key);
  return null;
};
const cacheSet = (key, data) => {
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
  resultCache.set(key, { data, ts: Date.now() });
};

// ---------------------------------------------------------------------------
// low-level GraphQL
// ---------------------------------------------------------------------------
async function getStoreAccess(shop) {
  const cached = tokenCache.get(shop);
  if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL_MS) return cached;
  const doc = await storeLookup(shop);
  if (!doc?.accessToken) return null;
  const entry = {
    token: doc.accessToken,
    domain: normalizeShopDomain(doc.domain) || shop,
    ts: Date.now(),
  };
  tokenCache.set(shop, entry);
  return entry;
}

/**
 * Runs one Admin GraphQL query. Returns `data` or null on any failure.
 * Never throws - callers treat null as "fallback unavailable".
 */
async function shopifyGraphql(rawShop, query, variables = {}, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const shop = normalizeShopDomain(rawShop);
  if (!isEnabled() || !shop || breakerOpen(shop)) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
  try {
    const access = await getStoreAccess(shop);
    if (!access) return null;

    const response = await getFetch()(`https://${access.domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": access.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!response.ok) {
      console.warn(`[FALLBACK] ${shop} HTTP ${response.status}`);
      recordFailure(shop);
      return null;
    }
    const json = await response.json();
    if (json?.errors?.length || !json?.data) {
      console.warn(`[FALLBACK] ${shop} GraphQL error:`, json?.errors?.[0]?.message || "no data");
      recordFailure(shop);
      return null;
    }
    recordSuccess(shop);
    return json.data;
  } catch (err) {
    console.warn(`[FALLBACK] ${shop} request failed:`, err?.name === "AbortError" ? "timeout" : err?.message);
    recordFailure(shop);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// mapping
// ---------------------------------------------------------------------------
const stripGid = (id) => String(id || "").replace(/^gid:\/\/shopify\/\w+\//, "");
const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Shopify Product node -> Mongo Product-like plain object. */
function mapNodeToProduct(node = {}) {
  const publishedAt = toDate(node.publishedAt);
  const createdAt = toDate(node.createdAt);
  const stock = Number.isFinite(Number(node.totalInventory)) ? Math.max(Number(node.totalInventory), 0) : 0;
  // untracked inventory means Shopify always sells it
  const availableForSale = stock > 0 || node.tracksInventory === false;
  const latest = publishedAt || createdAt;
  const price = Number(node.variants?.edges?.[0]?.node?.price || 0);

  return {
    productId: stripGid(node.id),
    title: node.title || "",
    handle: node.handle || "",
    vendor: node.vendor || "",
    productType: node.productType || "",
    tags: Array.isArray(node.tags) ? node.tags : [],
    image: node.featuredImage?.url || "",
    price: Number.isFinite(price) ? price : 0,
    stock,
    availableForSale,
    status: String(node.status || "ACTIVE").toUpperCase(),
    colors: [],
    sizes: [],
    collections: [],
    shopifyCreatedAt: createdAt,
    shopifyPublishedAt: publishedAt,
    publishedAt,
    // The Admin API only exposes the current publish date, not the first one.
    firstPublishedAt: publishedAt,
    latestTime: latest ? latest.getTime() : 0,
    latestDate: latest,
    fromFallback: true,
  };
}

const isLiveProduct = (product) => product.status === "ACTIVE" && Boolean(product.publishedAt);

// ---------------------------------------------------------------------------
// query building
// ---------------------------------------------------------------------------
const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const tokenize = (phrase) =>
  normalizeSearchText(phrase)
    .split(" ")
    .filter((token) => token.length >= 2)
    .slice(0, 6);

const tokenClause = (token) =>
  `(title:${token}* OR tag:${token} OR product_type:${token}* OR vendor:${token}*)`;

/**
 * Builds Shopify search queries (most strict first).
 *  - strict: every token of a phrase must match (phrases are OR'ed together)
 *  - relaxed: any token of any phrase may match
 * Only prefix wildcards are used because Shopify does not support leading ones.
 */
function buildSearchQueries({ phrases = [], vendor = null, productType = null, tags = [] } = {}) {
  const phraseTokens = phrases.map(tokenize).filter((tokens) => tokens.length);
  const extra = [];
  if (vendor) extra.push(`vendor:${quote(vendor)}`);
  if (productType) extra.push(`product_type:${quote(productType)}`);
  tags.filter(Boolean).forEach((tag) => extra.push(`tag:${quote(tag)}`));
  const base = ["status:active", ...extra].join(" AND ");

  // Vendor-only search ("maria b" resolved to a vendor): no text clause needed.
  if (!phraseTokens.length) return vendor ? [base] : [];

  const strict = phraseTokens.map((tokens) => `(${tokens.map(tokenClause).join(" AND ")})`);
  const allTokens = [...new Set(phraseTokens.flat())];
  const relaxed = allTokens.map(tokenClause);

  const queries = [`${base} AND (${strict.join(" OR ")})`];
  if (allTokens.length > 1) queries.push(`${base} AND (${relaxed.join(" OR ")})`);
  return queries;
}

// ---------------------------------------------------------------------------
// vendors / collections
// ---------------------------------------------------------------------------
const GARBAGE_VENDOR_PATTERNS = [
  /^add[\s-]?ons?$/i,
  /^addons?$/i,
  /^custom/i,
  /^default/i,
  /^test/i,
  /^unknown$/i,
  /^vendor$/i,
  /^[.\-_\s]+$/,
  /^\d+$/,
];
const isGarbageVendor = (name) => {
  const text = String(name || "").trim();
  return text.length < 2 || GARBAGE_VENDOR_PATTERNS.some((pattern) => pattern.test(text));
};

const GARBAGE_COLLECTION_PATTERNS = [
  /do[\s-]?not[\s-]?delete/i,
  /smart[\s-]?products[\s-]?filter/i,
  /bestseller[\s-]?collection/i,
  /orderlyemails/i,
  /most[\s-]?sales[\s-]?products/i,
  /best[\s-]?seller[\s-]?products/i,
  /products[\s-]?showcase/i,
  /^weight\s*\d+/i,
  /^shop[\s-]?by[\s-]?mood$/i,
  /^shop[\s-]?by$/i,
  /^brands?\s*a\s*to\s*z$/i,
  /^designers?$/i,
  /^over\b/i,
  /filter[\s-]?index/i,
  /^all[\s-]?products$/i,
  /^new[\s-]?arrivals$/i,
  /^\d{4}$/,
  /^[.\-_\s]+$/,
];
const isGarbageCollection = (title) => {
  const text = String(title || "").trim();
  return text.length < 3 || GARBAGE_COLLECTION_PATTERNS.some((pattern) => pattern.test(text));
};
const isRtsCollection = (collection = {}) =>
  /\brts\b|ready\s*to\s*ship/i.test(`${collection.title || ""} ${collection.handle || ""}`);

async function fetchVendors(rawShop) {
  const shop = normalizeShopDomain(rawShop);
  const cached = vendorCache.get(shop);
  if (cached && Date.now() - cached.ts < VENDOR_CACHE_TTL_MS) return cached.data;

  const data = await shopifyGraphql(shop, `{ shop { productVendors(first: 250) { edges { node } } } }`);
  const edges = data?.shop?.productVendors?.edges;
  if (!Array.isArray(edges)) return cached?.data || [];

  const vendors = edges.map((edge) => String(edge?.node || "").trim()).filter((name) => name && !isGarbageVendor(name));
  vendorCache.set(shop, { data: vendors, ts: Date.now() });
  return vendors;
}

/** Best vendor for the query + a few fuzzy neighbours, as search "vendors" entries. */
function matchVendors(query, vendors = [], ignoredWords = new Set()) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { best: null, list: [] };

  const best = resolveVendor(normalizedQuery, vendors, ignoredWords);
  const scored = new Map();
  if (best) scored.set(best, 100000);

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length >= 3 && !ignoredWords.has(token));
  vendors.forEach((vendor) => {
    const vendorName = normalizeSearchText(vendor);
    const vendorTokens = vendorName.split(" ").filter(Boolean);
    let score = scored.get(vendor) || 0;
    queryTokens.forEach((queryToken) => {
      vendorTokens.forEach((vendorToken) => {
        if (queryToken[0] !== vendorToken[0]) return; // same rule as main search
        const similarity = stringSimilarity.compareTwoStrings(queryToken, vendorToken);
        if (similarity > 0.7) score += similarity * 20000;
      });
    });
    if (score > 0) scored.set(vendor, score);
  });

  const list = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, score]) => ({ title, type: "vendor", score, latestDate: null }));

  // A fuzzy-only match (typo) is promoted to "best" when it is clearly strong.
  const resolvedBest = best || (list[0] && list[0].score >= 17000 ? list[0].title : null);
  return { best: resolvedBest, list };
}

async function fetchCollections(rawShop, phrases = [], { allowRts = false } = {}) {
  const tokens = [...new Set(phrases.flatMap(tokenize))].slice(0, 4);
  if (!tokens.length) return [];
  const search = tokens.map((token) => `title:${token}*`).join(" OR ");
  const data = await shopifyGraphql(
    rawShop,
    `query($q:String){ collections(first: 20, query: $q) { edges { node { title handle image { url } } } } }`,
    { q: search }
  );
  const edges = data?.collections?.edges || [];
  return edges
    .map((edge) => edge.node)
    .filter((c) => c?.handle && c?.title && !isGarbageCollection(c.title))
    .filter((c) => allowRts || !isRtsCollection(c))
    .slice(0, 10)
    .map((c) => ({ title: c.title, handle: c.handle, image: c.image?.url || "" }));
}

// ---------------------------------------------------------------------------
// public: search
// ---------------------------------------------------------------------------
const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * @param {object} opts
 * @param {string} opts.shop
 * @param {string} opts.query       original user query
 * @param {string[]} [opts.phrases] extra phrases (AI corrected, synonyms, colour translations)
 * @param {Set<string>} [opts.ignoredWords] generic words that must not resolve to a vendor
 * @param {object} [opts.filters]   { vendor, productType, tags[], minPrice, maxPrice, inStockOnly }
 * @returns {Promise<null | {products, vendors, collections, totalProducts, detectedVendor}>}
 */
async function searchFallback({ shop: rawShop, query, phrases = [], ignoredWords = new Set(), filters = {} } = {}) {
  const shop = normalizeShopDomain(rawShop);
  if (!isEnabled() || !shop || breakerOpen(shop)) return null;

  const originalQuery = String(query || "").trim();
  const allPhrases = [...new Set([originalQuery, ...phrases].map((p) => String(p || "").trim()).filter(Boolean))];
  if (!allPhrases.length && !filters.vendor) return null;

  const cacheKey = `search|${shop}|${JSON.stringify({ allPhrases, filters })}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const vendorList = await fetchVendors(shop);
  const explicitVendor = filters.vendor ? String(filters.vendor).trim() : null;
  const { best: resolvedVendor, list: vendorMatches } = explicitVendor
    ? { best: explicitVendor, list: [{ title: explicitVendor, type: "vendor", score: 100000, latestDate: null }] }
    : matchVendors(originalQuery, vendorList, ignoredWords);

  // If the whole query is just the vendor name, search by vendor only.
  const vendorOnly =
    resolvedVendor && normalizeSearchText(originalQuery) &&
    normalizeSearchText(resolvedVendor).startsWith(normalizeSearchText(originalQuery));

  const queries = buildSearchQueries({
    phrases: vendorOnly ? [] : allPhrases,
    vendor: resolvedVendor && (vendorOnly || explicitVendor) ? resolvedVendor : null,
    productType: filters.productType || null,
    tags: Array.isArray(filters.tags) ? filters.tags : [],
  });
  if (!queries.length) return null;

  const gql = `query($q:String!, $first:Int!){
    products(first: $first, query: $q, sortKey: RELEVANCE) { edges { node { ${PRODUCT_FIELDS} } } }
  }`;

  let nodes = [];
  let usedQuery = null;
  for (const q of queries) {
    const data = await shopifyGraphql(shop, gql, { q, first: SEARCH_CANDIDATE_LIMIT });
    if (data === null) break; // failure/timeout: stop, do not hammer Shopify
    nodes = (data.products?.edges || []).map((edge) => edge.node);
    usedQuery = q;
    if (nodes.length) break;
  }

  const minPrice = toNumberOrNull(filters.minPrice);
  const maxPrice = toNumberOrNull(filters.maxPrice);
  const seen = new Set();
  let products = nodes
    .map(mapNodeToProduct)
    .filter(isLiveProduct)
    .filter((p) => (seen.has(p.productId) ? false : (seen.add(p.productId), true)))
    .filter((p) => !isGarbageVendor(p.vendor))
    .filter((p) => (minPrice === null || p.price >= minPrice) && (maxPrice === null || p.price <= maxPrice))
    .filter((p) => !filters.inStockOnly || productIsAvailable(p));

  products = products
    .map((p) => ({ ...p, matchPriority: calculateMatchPriority(p, originalQuery) }))
    .sort((a, b) =>
      b.matchPriority - a.matchPriority ||
      Number(productIsAvailable(b)) - Number(productIsAvailable(a)) ||
      b.latestTime - a.latestTime
    )
    .map((p) => ({ ...p, score: p.matchPriority * 100 }));

  const collections = await fetchCollections(shop, allPhrases, {
    allowRts: /\brts\b|ready\s*to\s*ship/i.test(originalQuery),
  });

  const result = {
    products,
    vendors: vendorMatches,
    collections,
    totalProducts: products.length,
    detectedVendor: resolvedVendor || null,
    usedQuery,
  };

  // Do not cache a total miss that came from a failure; cache real answers only.
  if (usedQuery !== null) cacheSet(cacheKey, result);
  console.log(`[FALLBACK] search shop=${shop} q="${originalQuery}" results=${products.length} vendor=${resolvedVendor || "-"}`);
  return result;
}

// ---------------------------------------------------------------------------
// public: latest live products (trending)
// ---------------------------------------------------------------------------
async function fetchLatestProducts(rawShop, limit = 80) {
  const shop = normalizeShopDomain(rawShop);
  if (!isEnabled() || !shop || breakerOpen(shop)) return [];

  const first = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 100);
  const cacheKey = `latest|${shop}|${first}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await shopifyGraphql(
    shop,
    `query($first:Int!){
      products(first: $first, sortKey: PUBLISHED_AT, reverse: true, query: "status:active") {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }`,
    { first }
  );
  if (!data) return [];

  const products = (data.products?.edges || [])
    .map((edge) => mapNodeToProduct(edge.node))
    .filter(isLiveProduct)
    .filter((p) => !isGarbageVendor(p.vendor));

  cacheSet(cacheKey, products);
  console.log(`[FALLBACK] latest shop=${shop} results=${products.length}`);
  return products;
}

function _resetForTests() {
  tokenCache.clear();
  breaker.clear();
  resultCache.clear();
  vendorCache.clear();
  fetchImpl = null;
}

module.exports = {
  searchFallback,
  fetchLatestProducts,
  fetchVendors,
  fetchCollections,
  matchVendors,
  shopifyGraphql,
  buildSearchQueries,
  mapNodeToProduct,
  isGarbageVendor,
  isGarbageCollection,
  isEnabled,
  _resetForTests,
  _setFetchForTests: (fn) => { fetchImpl = fn; },
  _setStoreLookupForTests: (fn) => { storeLookup = fn; },
  _constants: { BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS, REQUEST_TIMEOUT_MS },
};
