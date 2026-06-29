const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const Product = require("../Models/productModel");
const Store = require("../Models/store")
const Collection = require("../Models/collectionModel");

// =========================
// 🎨 COLOR EXTRACTION HELPER
// Priority: metafields > variant color options > tags > title words
// =========================
const _COLOR_TAGS = new Set([
  'black','white','red','blue','green','yellow','pink','orange','purple',
  'maroon','navy','grey','gray','beige','cream','golden','gold','silver',
  'nude','ivory','mint','teal','mustard','burgundy','olive','rust','coral',
  'peach','lilac','lavender','rose','brown','tan','blush','turquoise',
  'magenta','fuchsia','emerald','violet','caramel','charcoal','champagne','taupe',
]);
const _COLOR_NORM = { gray: 'grey', gold: 'golden' };
const _COMPOUND_COLOR_NORM = {
  'off white': 'off-white',
  'off-white': 'off-white',
  offwhite: 'off-white',
  'sky blue': 'sky blue',
  'sky-blue': 'sky blue',
  skyblue: 'sky blue',
  'navy blue': 'navy blue',
  'navy-blue': 'navy blue',
  navyblue: 'navy blue',
  'rose gold': 'rose gold',
  'rose-gold': 'rose gold',
  rosegold: 'rose gold',
  'dark green': 'dark green',
  'dark-green': 'dark green',
  darkgreen: 'dark green',
  'dark blue': 'dark blue',
  'dark-blue': 'dark blue',
  darkblue: 'dark blue',
};

function extractProductColors({ metafields = [], variantOptions = [], tags = [], title = '' }) {
  const found = new Set();
  const exactCustomColors = new Set();
  const addExactCustom = (v) => {
    let c = (v || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
    if (!c || c.length <= 1 || c === 'default title' || c === 'none') return;
    if (/https?:|www\.|cdn\.|gid:|shopify|metaobject|\.com|\.webp|\.png|\.jpe?g|^\d+$/.test(c)) return;
    c = c
      .replace(/^["']|["']$/g, '')
      .replace(/^off\s+white$/, 'off-white')
      .replace(/^sky\s+blue$/, 'sky blue')
      .replace(/^navy\s+blue$/, 'navy blue')
      .replace(/^rose\s+gold$/, 'rose gold');
    exactCustomColors.add(_COLOR_NORM[c] || c);
  };
  const addCustomValue = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(v => addCustomValue(typeof v === 'string' ? v : (v?.value || v?.label || v?.name || '')));
        return;
      }
      if (parsed && typeof parsed === 'object') {
        addCustomValue(parsed.value || parsed.label || parsed.name || '');
        return;
      }
    } catch (_) {}
    raw.split(/[,|;\/]/).forEach(v => addExactCustom(v.trim()));
  };

  metafields.forEach(mf => {
    const namespace = String(mf.namespace || '').toLowerCase().trim();
    const key = String(mf.key || '').toLowerCase().trim();
    if (namespace === 'custom' && key === 'color') addCustomValue(mf.value);
  });
  if (exactCustomColors.size) return [...exactCustomColors];

  const add = (v) => {
    const c = (v || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (c.length <= 1 || c === 'default title' || c === 'none') return;
    if (/https?:|www\.|cdn\.|gid:|shopify|metaobject|\.com|\.webp|\.png|\.jpe?g|^\d+$/.test(c)) return;

    const normalized = _COMPOUND_COLOR_NORM[c] || _COLOR_NORM[c] || c;
    if (_COMPOUND_COLOR_NORM[c]) {
      found.add(normalized);
      return;
    }
    if (_COLOR_TAGS.has(normalized)) {
      found.add(normalized);
      return;
    }

    const tokens = normalized.split(/[\s\-_/|,]+/).filter(Boolean);
    const colorTokens = tokens
      .map(t => _COLOR_NORM[t] || t)
      .filter(t => _COLOR_TAGS.has(t));
    colorTokens.forEach(t => found.add(t));
    if (colorTokens.length && tokens.length <= 4 && normalized.length <= 40) found.add(normalized);
  };

  // 1. Metafields (color namespaces)
  metafields.forEach(mf => {
    const label = `${mf.namespace || ''} ${mf.key || ''}`.toLowerCase();
    if (!/(^|\W)(colou?r|shade|tone|palette)(\W|$)/i.test(label)) return;
    (mf.value || '').split(/[,|;\/]/).forEach(v => add(v.trim()));
  });

  // 2. Variant options named "Color" or "Colour"
  variantOptions.forEach(opt => {
    if (/^colou?r$/i.test(opt.name)) {
      (opt.value || '').split(/[,\/]/).forEach(v => add(v.trim()));
    }
  });

  // 3. Tags that are known color words
  (tags || []).forEach(tag => {
    const t = tag.toLowerCase().trim();
    if (_COLOR_TAGS.has(t)) add(t);
    if (/^off[\s-]?white$/i.test(t))  add('off-white');
    if (/^sky[\s-]?blue$/i.test(t))   add('sky blue');
    if (/^navy[\s-]?blue$/i.test(t))  add('navy blue');
    if (/^rose[\s-]?gold$/i.test(t))  add('rose gold');
    if (/^dark[\s-]?green$/i.test(t)) add('dark green');
  });

  // 4. Color words in the product title
  const tl = (title || '').toLowerCase();
  tl.split(/[\s\-|_\/,\(\)]+/).forEach(w => { if (_COLOR_TAGS.has(w)) add(w); });
  if (/off[\s-]?white/i.test(tl))  add('off-white');
  if (/sky[\s-]?blue/i.test(tl))   add('sky blue');
  if (/navy[\s-]?blue/i.test(tl))  add('navy blue');
  if (/rose[\s-]?gold/i.test(tl))  add('rose gold');
  if (/dark[\s-]?green/i.test(tl)) add('dark green');
  if (/dark[\s-]?blue/i.test(tl))  add('dark blue');

  return [...found];
}

function extractProductSizes({ variantOptions = [], tags = [] }) {
  const found = new Set();
  const add = (v) => {
    const size = String(v || '').trim();
    if (!size || /^default title$/i.test(size) || /^none$/i.test(size)) return;
    found.add(size);
  };

  variantOptions.forEach(opt => {
    if (/^(size|sizes)$/i.test(opt.name || "")) add(opt.value);
  });

  (tags || []).forEach(tag => {
    const t = String(tag || '').trim();
    if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large|extra small|extra large)$/i.test(t)) add(t);
    const prefixed = t.match(/^size[:\s_-]+(.+)$/i);
    if (prefixed) add(prefixed[1]);
  });

  return [...found];
}

// =========================
// 🔬 VISION AI COLOR DETECTION
// =========================
const VISION_COLOR_LIST = 'black, white, red, blue, green, yellow, pink, orange, purple, maroon, navy, grey, beige, cream, golden, silver, nude, ivory, mint, teal, mustard, burgundy, olive, rust, coral, peach, lilac, lavender, rose, brown, tan, blush, turquoise, magenta, fuchsia, emerald, violet, caramel, charcoal, champagne';
const VISION_COLOR_NORM = { gray: 'grey', gold: 'golden', 'off-white': 'ivory', 'off white': 'ivory', 'dark green': 'emerald', 'light pink': 'peach' };
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const VISION_PROMPT_TEXT = `Look at this fashion garment. Identify the 1-3 MAIN colors of the garment fabric only (ignore background, ignore pattern names like "floral" or "printed").

You MUST choose colors ONLY from this exact list:
${VISION_COLOR_LIST}

Rules:
- Return ONLY a JSON array, nothing else
- Max 3 colors, most dominant first
- No color words outside the list above
- Examples: ["black"] or ["white","golden"] or ["navy","cream","golden"]`;

async function _detectColorsVision(imageUrl, apiKey) {
  try {
    const res = await Promise.race([
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [{ role: "user", content: [
            { type: "text", text: VISION_PROMPT_TEXT },
            { type: "image_url", image_url: { url: imageUrl } }
          ]}],
          max_tokens: 80,
          temperature: 0
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Vision timeout")), 15000))
    ]);
    if (res.status === 429) { console.warn("[Vision Sync] Rate limited"); return []; }
    if (!res.ok) { console.warn(`[Vision Sync] HTTP ${res.status}`); return []; }
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    return JSON.parse(match[0])
      .map(c => { const l = (c || '').toLowerCase().trim(); return VISION_COLOR_NORM[l] || l; })
      .filter(c => _COLOR_TAGS.has(c))
      .slice(0, 3);
  } catch (e) {
    console.warn('[Vision Sync] Error:', e.message);
    return [];
  }
}

// 🔄 SYNC PRODUCTS (Fetch version)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function shopifyGraphqlWithRetry({ shop, accessToken, query, variables = {}, retries = 6 }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await Promise.race([
        fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query, variables })
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Shopify request timeout")), 60000))
      ]);

      if (response.status === 429) {
        const waitMs = Math.min(30000, 2000 * attempt);
        console.warn(`[Sync] Shopify rate limited. retry=${attempt}/${retries} wait=${waitMs}ms`);
        await delay(waitMs);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        lastError = new Error(`Shopify API Failed: ${response.status} ${errorText.slice(0, 200)}`);
        if (response.status >= 500 && attempt < retries) {
          await delay(Math.min(30000, 1500 * attempt));
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      if (data?.errors) {
        const message = data.errors?.[0]?.message || "Shopify GraphQL Error";
        lastError = new Error(message);
        if (/throttle|timeout|temporar|internal/i.test(message) && attempt < retries) {
          await delay(Math.min(30000, 1500 * attempt));
          continue;
        }
        throw lastError;
      }

      return data;
    } catch (err) {
      lastError = err;
      const retryable = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket|network|timeout|fetch/i.test(err.message || "");
      if (!retryable || attempt >= retries) break;
      const waitMs = Math.min(30000, 1500 * attempt);
      console.warn(`[Sync] Shopify fetch failed: ${err.message}. retry=${attempt}/${retries} wait=${waitMs}ms`);
      await delay(waitMs);
    }
  }
  throw lastError || new Error("Shopify API failed after retries");
}

router.post("/sync-products", async (req, res) => {

  let heartbeat;
  let clientConnected = true;

  try {

    let { shop, skipVision } = req.body;

    if (!shop) {

      return res.status(400).json({
        error: "Shop required"
      });
    }

    // =========================
    // 🔥 CLEAN SHOP DOMAIN
    // =========================
    shop = shop
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .trim()
      .toLowerCase();
    skipVision = skipVision === true || skipVision === "true";

    // =========================
    // 🔥 GET STORE TOKEN
    // =========================
    const store = await Store.findOne({
      domain: shop
    }).lean();

    if (!store) {

      return res.status(404).json({
        error: "Store not found"
      });
    }

    // SSE headers — stream progress to frontend
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    req.on("close", () => {
      clientConnected = false;
      console.warn("[Sync] Client connection closed; continuing product sync in background.");
    });

    const sendEvent = (data) => {
      if (!clientConnected || res.destroyed || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        clientConnected = false;
        console.warn("[Sync] Progress stream closed:", err.message);
      }
    };

    sendEvent({ type: "started", shop });

    let hasNextPage = true;

    let cursor = null;

    let totalSynced = 0;
    heartbeat = setInterval(() => {
      sendEvent({ type: "ping", synced: totalSynced });
    }, 15000);

    let allProductIds = new Set();
    let retryCount = 0;
    // =========================
    let previousCursor = null;
    let syncCompleted = false;
    // 🔥 LOOP ALL PRODUCTS
    // =========================
    while (hasNextPage) {
      const query = `
query getProducts($cursor: String) {

  products(
    first: 100,
    query:"status:active",
    after: $cursor
  ) {

    pageInfo {
  hasNextPage
  endCursor
}

    edges {

      cursor

      node {
  id
  title
  handle
  descriptionHtml
  vendor
  productType
  status
  tags
  createdAt
  updatedAt
  publishedAt
        featuredImage {
          url
        }

        metafields(first: 250) {
          edges {
            node {
              value
              key
              namespace
            }
          }
        }

        variants(first: 10) {
          edges {
            node {
              price
              inventoryQuantity
              selectedOptions {
                name
                value
              }
            }
          }
        }

        collections(first: 250) {
  edges {
    node {
      id
      title
    }
  }
}
      }
    }
  }
}
`;

      // =========================
      // 🔥 SHOPIFY API
      // =========================
      const data = await shopifyGraphqlWithRetry({
        shop,
        accessToken: store.accessToken,
        query,
        variables: { cursor }
      });

      // =========================
      // 🔥 CHECK ERRORS
      // =========================
      if (data?.errors) {

        console.error(
          "SHOPIFY GRAPHQL ERROR:",
          JSON.stringify(
            data.errors || data,
            null,
            2
          )
        );

        throw new Error(
          data.errors?.[0]?.message ||
          "Shopify GraphQL Error"
        );
      }

      if (
        !data?.data?.products
      ) {

        throw new Error(
          "Invalid Shopify products response"
        );
      }

      const products =
        data?.data?.products?.edges || [];

      const noColorItems = []; // products needing vision AI color detection

      if (
        products.length === 0
      ) {

        hasNextPage = false;
        syncCompleted = true;

        break;

      }

      // =========================
      // 🔥 BULK OPERATIONS
      // =========================
      const operations =
        products.map(item => {
          if (!item?.node) {
            return null;
          }
          const p = item.node;

          if (p.id) {
            allProductIds.add(
              String(p.id)
            );
          }
          // COLLECTIONS
          const collections =
            Array.isArray(
              p.collections?.edges
            )
              ? p.collections.edges
                .filter(c => c?.node)
                .map(
                  c => ({
                    id:
                      String(c.node.id),

                    title:
                      c.node.title || ""
                  })
                )
              : [];

          // PRICE
          const price =
            Number(
              p.variants?.edges?.[0]
                ?.node?.price || 0
            );

          // COLORS — from metafields + variant options
          const allVariantOptions = (p.variants?.edges || []).flatMap(e =>
            (e?.node?.selectedOptions || [])
          );
          const metafields = (p.metafields?.edges || []).map(e => e.node).filter(Boolean);
          const productColors = extractProductColors({
            metafields,
            variantOptions: allVariantOptions,
            tags: Array.isArray(p.tags) ? p.tags : [],
            title: p.title || ''
          });
          const productSizes = extractProductSizes({
            variantOptions: allVariantOptions,
            tags: Array.isArray(p.tags) ? p.tags : []
          });
          const stock = (p.variants?.edges || []).reduce((total, edge) =>
            total + Math.max(Number(edge?.node?.inventoryQuantity || 0), 0), 0
          );

          // Track for vision AI (no colors found + has image)
          if (productColors.length === 0 && p.featuredImage?.url) {
            noColorItems.push({ productId: String(p.id), imageUrl: p.featuredImage.url });
          }

          // SEARCHABLE TEXT
          const searchableText = [

            String(p.title || ""),

            String(p.vendor || ""),

            String(p.productType || ""),

            Array.isArray(p.tags)
              ? p.tags.join(" ")
              : "",

            Array.isArray(collections)
              ? collections
                .map(c => c.title)
                .join(" ")
              : "",

            productColors.join(" "),

            productSizes.join(" ")

          ]
            .join(" ")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

          return {

            updateOne: {

              filter: {
                store:
                  shop
                    .trim()
                    .toLowerCase(),
                productId: String(p.id)
              },

              update: {

                $set: {
                  store:
                    shop
                      .trim()
                      .toLowerCase(),

                  productId:
                    String(p.id),

                  title:
                    p.title || "",

                  handle:
                    p.handle || "",

                  description:
                    String(
                      p.descriptionHtml || ""
                    )
                      .replace(/<[^>]*>/g, "")
                      .slice(0, 2000),
                  vendor:
                    p.vendor || "",

                  productType:
                    p.productType || "",

                  tags:
                    Array.isArray(p.tags)
                      ? p.tags
                      : [],

                  image:
                    p.featuredImage?.url || "",

                  price: price || 0,

                  stock,

                  sizes: productSizes,

                  collections:
                    (collections || []).map(
                      c => String(c.id)
                    ),

                  status:
                    p.publishedAt
                      ? (p.status || "ACTIVE").toUpperCase()
                      : "UNPUBLISHED",

                  shopifyCreatedAt:
                    p.createdAt
                      ? new Date(p.createdAt)
                      : null,

                  publishedAt:
                    p.publishedAt
                      ? new Date(p.publishedAt)
                      : null,

                  shopifyPublishedAt:
                    p.publishedAt
                      ? new Date(p.publishedAt)
                      : null,

                  shopifyUpdatedAt:
                    p.updatedAt
                      ? new Date(p.updatedAt)
                      : null,
                  searchableText,

                  colors: productColors,
                },
                // 🔑 sirf pehli dafa (insert) set hoga, re-publish pe kabhi nahi
                $setOnInsert: {
                  firstPublishedAt:
                    p.publishedAt
                      ? new Date(p.publishedAt)
                      : null
                }
              },

              upsert: true
            }
          };
        }).filter(Boolean);

      // =========================
      // 🔥 SAVE BATCH
      // =========================
      if (operations.length > 0) {

        await Product.bulkWrite(
          operations,
          { ordered: false }
        );

        totalSynced +=
          operations.length;

        sendEvent({ type: "progress", synced: totalSynced });
      }

      // =========================
      // 🎨 VISION AI COLOR DETECTION
      // Run after bulkWrite for products with no colors found locally
      // =========================
      const visionApiKey = process.env.GROQ_API_KEY;
      if (noColorItems.length > 0 && visionApiKey && !skipVision) {
        const cleanShop = shop.trim().toLowerCase();
        let visionUpdated = 0;
        for (const item of noColorItems) {
          const colors = await _detectColorsVision(item.imageUrl, visionApiKey);
          if (colors.length > 0) {
            await Product.updateOne(
              { store: cleanShop, productId: item.productId },
              { $set: { colors } }
            );
            visionUpdated++;
          }
          // Slow down vision calls to stay friendlier with Groq rate limits.
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // =========================
      // 🔥 PAGINATION
      // =========================
      hasNextPage =
        Boolean(
          data?.data?.products
            ?.pageInfo?.hasNextPage
        );

      if (!hasNextPage) {
        syncCompleted = true;
      }

      const nextCursor =
        data?.data?.products
          ?.pageInfo?.endCursor || null;
      if (!nextCursor) {
        break;
      }
      if (
        nextCursor === previousCursor
      ) {
        break;
      }
      previousCursor =
        nextCursor;

      cursor =
        nextCursor;
    }

    // =========================
    // 🔥 DELETE REMOVED PRODUCTS
    // =========================

    if (
      syncCompleted &&
      totalSynced === allProductIds.size
    ) {

      // ❌ delete nahi karte — warna draft hone par row ud jaye aur
      // firstPublishedAt khatam ho jaye. Sirf UNPUBLISHED mark karte hain.
      await Product.updateMany(
        {
          store: shop.trim().toLowerCase(),
          productId: { $nin: Array.from(allProductIds) }
        },
        {
          $set: {
            status: "UNPUBLISHED",
            publishedAt: null,
            shopifyPublishedAt: null
          }
        }
      );

    }

    // =========================
    // ✅ DONE
    // =========================
    if (heartbeat) clearInterval(heartbeat);
    sendEvent({ type: "done", total: totalSynced });
    if (clientConnected && !res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (err) {
    console.error(err);
    if (heartbeat) clearInterval(heartbeat);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else if (clientConnected && !res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      res.end();
    }
  }
});

// ==========================================
// 🔥 SYNC COLLECTIONS
// ==========================================
router.post("/sync-collections", async (req, res) => {
  try {
    const { shop } =
      req.body;
    if (!shop) {
      return res.status(400).json({
        error:
          "Shop is required"
      });
    }
    const normalizedShop =
      shop
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .trim()
        .toLowerCase();

    // ======================================
    // 🔥 SHOPIFY SESSION
    // ======================================
    const session =
      await Store.findOne({
        domain: normalizedShop
      });
    if (!session) {
      return res.status(404).json({
        error:
          "Store session not found"
      });
    }

    // SSE headers — stream progress to frontend
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendColEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendColEvent({ type: "started", shop: normalizedShop });

    // ======================================
    // 🔥 STORE ALL IDS
    // ======================================
    let collectionIds =
      new Set();

    const collectionSyncCounts = {
      custom_collections: 0,
      smart_collections: 0
    };

    const rawCollections =
      await Product.distinct(
        "collections",
        {
          store:
            normalizedShop,
          status: {
            $in: [
              "ACTIVE",
              "active"
            ]
          },
          publishedAt: {
            $ne: null
          }
        }
      );

    const activeCollections =
      new Set(
        rawCollections
          .map(id =>

            String(id)
              .split("/")
              .pop()

          )
      );

    // ======================================
    // 🔥 FETCH FUNCTION
    // ======================================
    const fetchCollections =
      async (type) => {

        let retryCount = 0;
        let hasMore = true;

        let nextPageUrl =
          `https://${normalizedShop}/admin/api/2026-04/${type}.json?limit=250`;

        while (hasMore) {

          const response =
            await fetch(
              nextPageUrl,

              {
                headers: {
                  "X-Shopify-Access-Token":
                    session.accessToken,
                  "Content-Type":
                    "application/json"
                }
              }
            );
          // ==============================
          // 🔥 RATE LIMIT
          // ==============================

          if (response.status === 429) {

            retryCount++;


            if (retryCount >= 5) {

              throw new Error(
                "Collections rate limit exceeded"
              );

            }

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  2000 * retryCount
                )
            );

            continue;

          }

          retryCount = 0;

          if (!response.ok) {

            const errorText =
              await response.text();

            console.error("COLLECTION API ERROR:", errorText);

            throw new Error(
              `Collections API Failed: ${response.status}`
            );

          }

          const linkHeader =
            response.headers.get("link");

          if (
            linkHeader &&
            linkHeader.includes('rel="next"')
          ) {

            const nextLink =
              linkHeader
                ?.split(",")
                ?.find(link =>
                  link.includes('rel="next"')
                );

            const match =
              nextLink?.match(
                /<([^>]+)>/
              );

            nextPageUrl =
              match?.[1] || null;

            hasMore =
              !!nextPageUrl;

          } else {

            hasMore = false;

          }

          const data =
            await response.json();
          const throttleStatus =
            data?.extensions?.cost
              ?.throttleStatus;

          if (
            throttleStatus &&
            throttleStatus
              .currentlyAvailable < 100
          ) {

            await new Promise(
              resolve =>
                setTimeout(resolve, 1500)
            );

          }
          const collections =
            Array.isArray(data[type])
              ? data[type]
              : [];

          // ==============================
          // 🔥 STOP PAGINATION
          // ==============================

          if (collections.length === 0) {

            break;

          }

          // ==============================
          // 🔥 PREPARE BULK OPS
          // ==============================

          const bulkOps =
            collections
              .map(c => {
                // ONLY ACTIVE PRODUCTS
                if (
                  !activeCollections.has(
                    String(c.id)
                  )
                ) {
                  return null;
                }
                collectionIds.add(
                  String(c.id)
                );

                const description =
                  String(
                    c.body_html || ""
                  )
                    .replace(/<[^>]*>/g, "")
                    .slice(0, 2000);

                const searchableText = [
                  c.title || "",
                  c.handle || "",
                  description
                ]
                  .join(" ")
                  .toLowerCase()
                  .replace(/\s+/g, " ")
                  .trim();

                return {
                  updateOne: {
                    filter: {
                      store:
                        normalizedShop,
                      collectionId:
                        String(c.id)
                    },

                    update: {

                      $set: {

                        store:
                          normalizedShop,

                        collectionId:
                          String(c.id),

                        title:
                          c.title || "",

                        handle:
                          c.handle || "",

                        description:
                          description,

                        image:
                          c.image?.src || "",

                        productsCount:
                          Number(
                            c.products_count || 0
                          ),

                        rules:
                          c.rules || [],

                        collectionType:
                          type,

                        shopifyCreatedAt:
                          c.created_at
                            ? new Date(
                              c.created_at
                            )
                            : null,

                        shopifyPublishedAt:
                          c.published_at
                            ? new Date(
                              c.published_at
                            )
                            : null,

                        firstPublishedAt:
                          c.published_at
                            ? new Date(c.published_at)
                            : (
                              c.created_at
                                ? new Date(c.created_at)
                                : null
                            ),

                        searchableText

                      }

                    },

                    upsert: true

                  }

                };

              }).filter(Boolean);

          // ==============================
          // 🔥 BULK WRITE
          // ==============================

          if (bulkOps.length > 0) {

            await Collection.bulkWrite(
              bulkOps,
              {
                ordered: false
              }
            );

            collectionSyncCounts[type] +=
              bulkOps.length;

            sendColEvent({
              type: "progress",
              collectionType: type,
              synced: collectionSyncCounts[type],
              total: collectionSyncCounts.custom_collections + collectionSyncCounts.smart_collections
            });

          }


          // ==============================
          // 🔥 NEXT PAGE
          // ==============================

        }

      };

    // ======================================
    // 🔥 FETCH BOTH TYPES
    // ======================================

    await fetchCollections(
      "custom_collections"
    );
    await fetchCollections(
      "smart_collections"
    );

    // ======================================
    // 🔥 CLEANUP OLD COLLECTIONS
    // ======================================
    const totalCollections =
      collectionIds.size;
    if (
      totalCollections > 0
    ) {
      await Collection.deleteMany({
        store:
          normalizedShop,
        collectionId: {
          $nin:
            Array.from(
              collectionIds
            )
        }
      });
    }

    // ======================================
    // ✅ DONE
    // ======================================
    sendColEvent({
      type: "done",
      total: totalCollections,
      custom: collectionSyncCounts.custom_collections,
      smart: collectionSyncCounts.smart_collections
    });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      res.end();
    }
  }
}
);

// ==========================================
// 🎨 BACKFILL PRODUCT COLORS (Vision AI)
// Processes products without colors using Groq vision model.
// POST /api/backfill-product-colors
// body: { shop, limit: 50 }
// ==========================================

// GET /api/backfill-colors-count?shop=xxx  — how many products still need colors
router.get("/backfill-colors-count", async (req, res) => {
  try {
    let { shop } = req.query;
    if (!shop) return res.status(400).json({ error: "Shop required" });
    shop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "").trim().toLowerCase();

    const [total, noColors, withImage] = await Promise.all([
      Product.countDocuments({ store: shop, status: "ACTIVE" }),
      Product.countDocuments({ store: shop, status: "ACTIVE", $or: [{ colors: { $size: 0 } }, { colors: { $exists: false } }] }),
      Product.countDocuments({ store: shop, status: "ACTIVE", image: { $exists: true, $ne: "" }, $or: [{ colors: { $size: 0 } }, { colors: { $exists: false } }] })
    ]);

    res.json({ total, noColors, needsVision: withImage, hasColors: total - noColors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/backfill-product-colors", async (req, res) => {
  try {
    let { shop, limit = 100, offset = 0, visionOnly = false } = req.body;
    if (!shop) return res.status(400).json({ error: "Shop required" });

    shop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "").trim().toLowerCase();
    limit  = Math.min(Number(limit)  || 100, 500); // cap at 500 per batch
    offset = Number(offset) || 0;

    // ── PHASE 1: local extraction (no API) ──────────────────────────────
    // Fill colors from tags + title — free, fast, no rate limits
    if (!visionOnly) {
      const localProducts = await Product.find({
        store: shop,
        status: "ACTIVE",
        $or: [{ colors: { $size: 0 } }, { colors: { $exists: false } }]
      })
        .select("_id title tags")
        .skip(offset)
        .limit(limit)
        .lean();

      const localOps = [];
      let localUpdated = 0;

      for (const product of localProducts) {
        const colors = extractProductColors({
          metafields: [],
          variantOptions: [],
          tags: product.tags || [],
          title: product.title || ''
        });
        if (colors.length) {
          localOps.push({
            updateOne: {
              filter: { _id: product._id },
              update: { $set: { colors } }
            }
          });
          localUpdated++;
        }
      }

      if (localOps.length) {
        await Product.bulkWrite(localOps, { ordered: false });
      }

      // Count still empty after local pass
      const stillEmpty = await Product.countDocuments({
        store: shop,
        status: "ACTIVE",
        $or: [{ colors: { $size: 0 } }, { colors: { $exists: false } }]
      });

      res.json({
        phase: "local",
        processed: localProducts.length,
        localUpdated,
        stillNeedVision: stillEmpty,
        message: `Local done. ${localUpdated} filled from tags/title. ${stillEmpty} still need vision API.`
      });
      return;
    }

    // ── PHASE 2: vision API (only products with no colors + has image) ───
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "GROQ_API_KEY not set" });

    const products = await Product.find({
      store: shop,
      status: "ACTIVE",
      image: { $exists: true, $ne: "" },
      $or: [{ colors: { $size: 0 } }, { colors: { $exists: false } }]
    })
      .select("_id productId title image")
      .skip(offset)
      .limit(limit)
      .lean();

    res.json({
      phase: "vision",
      processing: products.length,
      offset,
      nextOffset: offset + products.length,
      message: `Vision processing ${products.length} products in background. offset=${offset}`
    });

    // Background processing
    let updated = 0;
    let failed  = 0;
    let rateLimitHits = 0;
    // Groq vision is slower; keep a conservative cooldown between products.
    let globalCooldown = 5000;

    for (const product of products) {
      try {
        let retries = 0;
        let success = false;

        while (retries < 3 && !success) {
          try {
            const visionRes = await Promise.race([
              fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: VISION_MODEL,
                  messages: [{ role: "user", content: [
                    { type: "text", text: VISION_PROMPT_TEXT },
                    { type: "image_url", image_url: { url: product.image } }
                  ]}],
                  max_tokens: 80,
                  temperature: 0
                })
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Vision timeout")), 15000))
            ]);

            // Rate limit — exponential backoff, bump cooldown
            if (visionRes.status === 429) {
              rateLimitHits++;
              const waitMs = [15000, 30000, 60000][retries] || 60000;
              globalCooldown = Math.min(globalCooldown + 2000, 12000);
              console.log(`VISION RATE LIMIT hit ${rateLimitHits}, waiting ${waitMs/1000}s...`);
              await new Promise(r => setTimeout(r, waitMs));
              retries++;
              if (retries >= 3) { failed++; success = true; }
              continue;
            }

            // Reset cooldown on success
            globalCooldown = Math.max(globalCooldown - 500, 5000);

            if (!visionRes.ok) {
              const errText = await visionRes.text();
              console.warn(`[Vision] HTTP ${visionRes.status} for ${product.productId}:`, errText.slice(0, 200));
              failed++; success = true; continue;
            }

            const visionData = await visionRes.json();
            const visionText = (visionData?.choices?.[0]?.message?.content || '').trim();
            console.log(`[Vision] ${product.productId} → "${visionText.slice(0, 80)}"`);
            const arrMatch = visionText.match(/\[[\s\S]*?\]/);
            if (!arrMatch) { failed++; success = true; continue; }

            const detectedColors = JSON.parse(arrMatch[0])
              .map(c => { const l = (c || '').toLowerCase().trim(); return VISION_COLOR_NORM[l] || l; })
              .filter(c => _COLOR_TAGS.has(c))
              .slice(0, 3);

            if (detectedColors.length) {
              await Product.updateOne(
                { _id: product._id },
                { $set: { colors: detectedColors } }
              );
              updated++;
            } else {
              failed++;
            }
            success = true;

          } catch (innerErr) {
            retries++;
            if (retries >= 3) { failed++; success = true; }
          }
        }

        // Dynamic delay — starts 5s (12 RPM), bumps up when rate limited
        await new Promise(r => setTimeout(r, globalCooldown));

      } catch (err) {
        console.error("Vision color error:", product.productId, err.message);
        failed++;
      }
    }

    console.log(`VISION BACKFILL DONE: updated=${updated} failed=${failed} rateLimitHits=${rateLimitHits} store=${shop} offset=${offset}`);

  } catch (err) {
    console.error("BACKFILL COLORS ERROR:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ⚠️ TEMPORARY — ek dafa chala kar HATA dena
router.get("/backfill-collection-first-published", async (req, res) => {

  const docs =
    await Collection.find({
      $or: [
        {
          firstPublishedAt: null
        },
        {
          firstPublishedAt: {
            $exists: false
          }
        }
      ]
    })
      .select(
        "_id shopifyPublishedAt shopifyCreatedAt"
      )
      .lean();

  console.log(
    "COLLECTIONS TO BACKFILL:",
    docs.length
  );

  let updated = 0;

  for (const d of docs) {

    await Collection.updateOne(
      { _id: d._id },
      {
        $set: {
          firstPublishedAt:
            d.shopifyPublishedAt ||
            d.shopifyCreatedAt ||
            null
        }
      }
    );

    updated++;
  }

  res.json({
    success: true,
    updated,
    found: docs.length
  });

});

module.exports = router;
