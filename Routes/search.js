const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const Store = require('../Models/store')
const Analytics = require("../Models/analyticsModel");
const Synonym = require("../Models/synonymModel");
const Boost = require("../Models/boostModel");
const Product = require("../Models/productModel")
const Collection = require("../Models/collectionModel");
const FeaturedBrand = require("../Models/featuredBrandsModel");
const TrendingSettings = require("../Models/trendingSettingsModel");
const Settings = require("../Models/settingsModel");
const Filter = require("../Models/Filter");
const stringSimilarity = require("string-similarity");
// =========================
// AI EXPANSION (Groq Llama)
// =========================

const aiCache = {};
const AI_CACHE_TTL = 1000 * 60 * 30; // 30 min — reduces AI calls significantly
const aiInFlight = new Map(); // in-flight dedup: same query → share one AI call

const AI_PRIMARY_MODEL = "llama-3.3-70b-versatile";
const AI_FALLBACK_MODEL = "llama-3.1-8b-instant";
const AI_SEARCH_BLOCKING_BUDGET_MS = 120;
const SEARCH_DEBUG = process.env.SEARCH_DEBUG === "true";
const searchDebug = (...args) => {
  if (SEARCH_DEBUG) console.log(...args);
};
const SAFE_EXPANSION_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant"
]);

async function _callExpansionModel(query, modelName, apiKey, prompt) {
  try {
    const response = await Promise.race([
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0 })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("AI timeout")), 1500))
    ]);

    // Fast-fail on any non-200 — no waiting, no retries in real-time search
    if (!response.ok) {
      console.warn(`[AI] ${modelName} HTTP ${response.status}`);
      return null;
    }

    const json = await response.json();
    if (json?.error) {
      console.warn(`[AI] ${modelName} error:`, json.error?.message || json.error);
      return null;
    }

    const text = (json?.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[AI] ${modelName} no JSON in response: ${text.slice(0, 150)}`);
      return null;
    }
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn(`[AI] ${modelName} exception:`, e.message);
    return null;
  }
}

async function getAiExpansion(query, modelName = AI_PRIMARY_MODEL, storeContext = {}) {
  const key = query.toLowerCase().trim();

  // 1. Cache hit
  const cached = aiCache[key];
  if (cached && Date.now() - cached.timestamp < AI_CACHE_TTL) return cached.data;

  // 2. In-flight dedup — if same query already processing, share the result
  if (aiInFlight.has(key)) return aiInFlight.get(key);

  const promise = _runAiExpansion(key, query, modelName, storeContext);
  aiInFlight.set(key, promise);
  promise.finally(() => aiInFlight.delete(key));
  return promise;
}

async function _runAiExpansion(key, query, modelName, storeContext) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) { console.error("[AI] GROQ_API_KEY missing"); return null; }
    searchDebug(`[AI] Expansion -> model: ${modelName}, query: "${query}"`);

    const vendors = (storeContext.vendors || []).slice(0, 50);
    const productTypes = storeContext.productTypes || [];

    // Store-specific prompt tuned for Nainpreet — Pakistani luxury pret store
    const prompt = `You are a search query analyzer for a Pakistani luxury pret fashion store. Return structured JSON only.

STORE CONTEXT:
Brands: ${vendors.length ? vendors.join(", ") : "none"}
Product Types: ${productTypes.length ? productTypes.join(", ") : "kurta, co-ord set, salwar suit, 3-piece suit, lawn suit, kaftan, tissue wear, formal wear, casual wear, bridal, couture, accessories"}

QUERY: "${query}"

STORE SPECIALIZES IN: Pakistani luxury pret — kurtas, co-ord sets, 3-piece salwar suits (shirt+dupatta+trouser), lawn suits, kaftans, tissue wear, formal/bridal couture, accessories. Brands include top Pakistani designers.

RULES:
Language: English/Urdu/Roman Urdu mixed.
Urdu colors: mehroon=maroon, burgundy=maroon, wine=maroon, lal=red, kala/kali=black, safed=white, gulabi=pink, neela/neeli=blue, hara/hari=green, peela/peeli=yellow, surmai=grey, jamni=purple, sunehra=golden, asmani=sky blue, firozi=turquoise, skin=nude, off white=off-white
Urdu occasions: shadi/barat/baraat=wedding, dawat/function/dinner=party, valima/waleema=wedding, mehndi=mehndi, eid=festive, daftar/office=formal, rozana/daily=casual
Urdu product types: jora=suit, dupatta=dupatta, shalwar kameez=salwar suit, lehnga=lehenga, gharara=gharara, kurta=kurta
Brands: ONLY from Available Brands above. brands=[] if not found. confidence>90% required. Never treat colors/occasions/fabric/product-types as brands.
Colors: ONLY if explicitly mentioned in query. Never guess. Normalize + generate colorSynonyms (e.g. maroon→["mehroon","burgundy","wine","lal"]).
Fabric: ONLY if explicitly mentioned. Options: lawn,chiffon,organza,silk,tissue,khaddar,karandi,jacquard,net,velvet,cambric,viscose,georgette,cotton
Occasions: dawat/dinner/party/function→party | mehndi→mehndi | barat/valima/nikah/shadi→wedding | eid→festive | office/daftar→formal | daily/university/rozana→casual | bridal/dulhan→wedding
Attributes: ONLY if explicitly mentioned. Options: embroidered,printed,digital print,luxury,heavy,light,bridal,handwork,sequence,stone work,schiffli,nakshi,ready to wear,unstitched,stitched,3-piece,2-piece,co-ord
Price: under/below/tak/se kam→priceMax | above/se upar→priceMin | 20k=20000 | 1 lakh=100000 | NOTE: expensive luxury items may have price=0 in system
Intent: product_search|brand_search|collection_search|category_search|color_search|occasion_search|price_search|unknown
searchKeywords: 4-5 English retrieval phrases specific to Pakistani fashion, same category/occasion as query, no prices, no brands. Use terms like "pret", "lawn suit", "3-piece", "embroidered", "designer" etc.
negativeKeywords: only obvious opposites (unstitched query→["stitched"])
searchPhrase: clean English $text search phrase using Pakistani fashion vocabulary
Hard filter policy: shouldApplyColorFilter/CategoryFilter/CollectionFilter must be true ONLY when that exact color/category/collection is explicitly present in QUERY. If you infer category/productType/occasion from a generic word like "dress", keep it for soft ranking only and leave hard filter flags false.
Do not invent productType. If query is generic, use broad searchKeywords and high confidence only for intent, not for hard filters.

Return ONLY valid JSON, no markdown, no explanation:
{"originalQuery":"","correctedQuery":"","intent":"","confidence":0,"brands":[],"categories":[],"subCategories":[],"collections":[],"colors":[],"colorSynonyms":[],"fabric":[],"materials":[],"gender":[],"ageGroup":[],"sizes":[],"occasion":[],"season":[],"attributes":[],"style":[],"embellishment":[],"priceMin":null,"priceMax":null,"keywords":[],"searchKeywords":[],"negativeKeywords":[],"shouldApplyBrandFilter":false,"shouldApplyColorFilter":false,"shouldApplyCategoryFilter":false,"shouldApplyCollectionFilter":false,"searchPhrase":""}`;

    // Hard cap: AI improves ranking, but search must not wait long for it.
    let hardTimer;
    const hardTimeout = new Promise(resolve => { hardTimer = setTimeout(() => resolve(null), 2200); });
    let parsed = await Promise.race([
      (async () => {
        let result = await _callExpansionModel(query, modelName, apiKey, prompt);
        if (!result && modelName !== AI_FALLBACK_MODEL) {
          console.warn(`[AI] Primary failed, trying Groq fallback: ${AI_FALLBACK_MODEL}`);
          result = await _callExpansionModel(query, AI_FALLBACK_MODEL, apiKey, prompt);
        }
        // DeepSeek/Gemini fallback disabled for now.
        return result;
      })(),
      hardTimeout
    ]);
    clearTimeout(hardTimer);
    if (!parsed) return null;

    const VALID_OCCASIONS = new Set(['eid', 'mehndi', 'barat', 'valima', 'nikkah', 'wedding', 'party', 'festive', 'casual', 'formal', 'bridal', 'summer', 'winter']);

    // Parse occasions array (new schema has occasion as array)
    const occasionsArr = (Array.isArray(parsed.occasion) ? parsed.occasion : (parsed.occasion ? [parsed.occasion] : []))
      .map(o => (o || '').toLowerCase().trim())
      .filter(o => VALID_OCCASIONS.has(o));

    // Parse colors array
    const colorsArr = (Array.isArray(parsed.colors) ? parsed.colors : (parsed.colors ? [parsed.colors] : []))
      .map(c => (c || '').toLowerCase().trim())
      .filter(Boolean);

    // Parse brands array
    const brandsArr = (Array.isArray(parsed.brands) ? parsed.brands : [])
      .map(b => (b || '').toLowerCase().trim())
      .filter(b => b.length > 1);

    // searchKeywords — shown as suggestions and used for scoring
    const searchKeywords = (Array.isArray(parsed.searchKeywords) ? parsed.searchKeywords : [])
      .map(r => (r || '').toLowerCase().trim())
      .filter(r => r.length >= 2)
      .slice(0, 6);

    const data = {
      // ── Backward-compat fields (existing search logic uses these) ──
      corrected: (parsed.correctedQuery || '').toLowerCase().trim() || null,
      brandHint: brandsArr[0] || null,
      maxPrice: typeof parsed.priceMax === 'number' && parsed.priceMax > 0 ? parsed.priceMax : null,
      minPrice: typeof parsed.priceMin === 'number' && parsed.priceMin > 0 ? parsed.priceMin : null,
      color: colorsArr[0] || null,
      productType: (Array.isArray(parsed.subCategories) && parsed.subCategories[0])
        ? parsed.subCategories[0].toLowerCase().trim()
        : ((Array.isArray(parsed.categories) && parsed.categories[0]) ? parsed.categories[0].toLowerCase().trim() : null),
      occasion: occasionsArr[0] || null,
      related: searchKeywords,

      // ── Extended fields ──
      intent: (parsed.intent || 'product_search').toLowerCase(),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      brands: brandsArr,
      categories: (Array.isArray(parsed.categories) ? parsed.categories : []).map(c => c.toLowerCase().trim()),
      subCategories: (Array.isArray(parsed.subCategories) ? parsed.subCategories : []).map(s => s.toLowerCase().trim()),
      aiCollections: (Array.isArray(parsed.collections) ? parsed.collections : []).map(c => c.toLowerCase().trim()),
      colors: colorsArr,
      colorSynonyms: (Array.isArray(parsed.colorSynonyms) ? parsed.colorSynonyms : []).map(c => c.toLowerCase().trim()),
      fabric: (Array.isArray(parsed.fabric) ? parsed.fabric : []).map(f => f.toLowerCase().trim()),
      materials: (Array.isArray(parsed.materials) ? parsed.materials : []).map(m => m.toLowerCase().trim()),
      gender: (Array.isArray(parsed.gender) ? parsed.gender : []).map(g => g.toLowerCase().trim()),
      ageGroup: (Array.isArray(parsed.ageGroup) ? parsed.ageGroup : []).map(a => a.toLowerCase().trim()),
      sizes: (Array.isArray(parsed.sizes) ? parsed.sizes : []).map(s => s.toLowerCase().trim()),
      occasions: occasionsArr,
      season: (Array.isArray(parsed.season) ? parsed.season : []).map(s => s.toLowerCase().trim()),
      attributes: (Array.isArray(parsed.attributes) ? parsed.attributes : []).map(a => a.toLowerCase().trim()),
      style: (Array.isArray(parsed.style) ? parsed.style : []).map(s => s.toLowerCase().trim()),
      embellishment: (Array.isArray(parsed.embellishment) ? parsed.embellishment : []).map(e => e.toLowerCase().trim()),
      searchKeywords,
      negativeKeywords: (Array.isArray(parsed.negativeKeywords) ? parsed.negativeKeywords : []).map(n => n.toLowerCase().trim()),
      shouldApplyBrandFilter: Boolean(parsed.shouldApplyBrandFilter),
      shouldApplyColorFilter: Boolean(parsed.shouldApplyColorFilter),
      shouldApplyCategoryFilter: Boolean(parsed.shouldApplyCategoryFilter),
      shouldApplyCollectionFilter: Boolean(parsed.shouldApplyCollectionFilter),
      searchPhrase: typeof parsed.searchPhrase === 'string' ? parsed.searchPhrase.toLowerCase().trim() : null,
    };

    // Occasion cross-contamination guard: strip bridal terms from casual queries and vice versa
    const queryHasBridal = ['bridal', 'barat', 'valima', 'waleema', 'nikah', 'nikkah', 'dulhan', 'bride', 'shadi', 'mehndi'].some(t => key.includes(t));
    const queryIsCasual = ['party', 'dinner', 'casual', 'office', 'daily', 'festive', 'function', 'event', 'dawat'].some(t => key.includes(t));

    if (!queryHasBridal && data.related.length) {
      const BRIDAL_TERMS = ['bridal', 'barat', 'valima', 'waleema', 'nikah', 'dulhan', 'mehndi', 'mangni', 'bride', 'heavy bridal'];
      data.related = data.related.filter(term => !BRIDAL_TERMS.some(bt => term.includes(bt)));
      data.searchKeywords = data.related;
    }
    if (queryIsCasual && !queryHasBridal && data.related.length) {
      data.related = data.related.filter(term => !['wedding', 'shadi'].some(bt => term.includes(bt)));
      data.searchKeywords = data.related;
    }

    aiCache[key] = { data, timestamp: Date.now() };
    return data;

  } catch (err) {
    console.error(`[AI] Exception (model: ${modelName}):`, err.message);
    return null;
  }
}

// =========================
// 💰 LOCAL PRICE PARSER
// Parses price ceiling directly from query — no AI needed.
// Examples: "under 100K", "below 5000", "100k tak", "2 hazar mein", "1 lakh se kam"
// =========================
function parseMaxPriceFromQuery(query) {
  const q = (query || "").toLowerCase();

  // "2 hazar / 2 hazaar" → 2000
  const hazarM = q.match(/(\d+)\s*haza+r/);
  if (hazarM) return parseInt(hazarM[1], 10) * 1000;

  // "1 lakh / 1 lac" → 100000
  const lakhM = q.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac)\b/);
  if (lakhM) return Math.round(parseFloat(lakhM[1]) * 100000);

  // "under/below/max X K"  or  "X K tak/se kam"
  const kM = q.match(/(?:under|below|less\s*than|se\s*kam|max)\s*(\d+)\s*k\b|(\d+)\s*k\s*(?:tak|se\s*kam|mein)/);
  if (kM) return parseInt(kM[1] || kM[2], 10) * 1000;

  // "under/below X"  (plain 3+ digit number, no K)
  const plainUnder = q.match(/(?:under|below|less\s*than|se\s*kam)\s*(\d{3,})/);
  if (plainUnder) return parseInt(plainUnder[1], 10);

  // "X tak / X mein"  (plain 3+ digit number)
  const takM = q.match(/(\d{3,})\s*(?:tak|se\s*kam|mein)\b/);
  if (takM) return parseInt(takM[1], 10);

  return null;
}

// =========================
// 🎨 COLOR DETECTION
// Parses color(s) from the query — supports English + Roman Urdu color words.
// Returns normalized English color names (e.g. "lal" → "red", "kala" → "black").
// =========================
const QUERY_COLORS = new Map([
  // English
  ["black", "black"], ["white", "white"], ["red", "red"], ["blue", "blue"], ["green", "green"],
  ["yellow", "yellow"], ["pink", "pink"], ["orange", "orange"], ["purple", "purple"],
  ["maroon", "maroon"], ["navy", "navy"], ["grey", "grey"], ["gray", "grey"],
  ["beige", "beige"], ["cream", "cream"], ["golden", "golden"], ["gold", "golden"],
  ["silver", "silver"], ["nude", "nude"], ["ivory", "ivory"], ["mint", "mint"],
  ["teal", "teal"], ["mustard", "mustard"], ["burgundy", "burgundy"], ["olive", "olive"],
  ["rust", "rust"], ["coral", "coral"], ["peach", "peach"], ["lilac", "lilac"],
  ["lavender", "lavender"], ["rose", "rose"], ["brown", "brown"], ["tan", "tan"],
  ["blush", "blush"], ["turquoise", "turquoise"], ["magenta", "magenta"],
  ["fuchsia", "fuchsia"], ["emerald", "emerald"], ["violet", "violet"],
  ["caramel", "caramel"], ["charcoal", "charcoal"], ["champagne", "champagne"],
  // Roman Urdu
  ["lal", "red"], ["safed", "white"], ["kala", "black"], ["kali", "black"],
  ["neela", "blue"], ["neeli", "blue"], ["hara", "green"], ["hari", "green"],
  ["peela", "yellow"], ["peeli", "yellow"], ["gulabi", "pink"], ["surmai", "grey"],
  ["zard", "yellow"], ["asmani", "sky blue"], ["jamni", "purple"], ["gehra", "dark"],
]);

const COMPOUND_COLORS = [
  [/\boff[\s-]?white\b/, "off-white"],
  [/\bsky[\s-]?blue\b/, "sky blue"],
  [/\bnavy[\s-]?blue\b/, "navy blue"],
  [/\blight[\s-]?pink\b/, "light pink"],
  [/\bdeep[\s-]?red\b/, "deep red"],
  [/\bforest[\s-]?green\b/, "forest green"],
  [/\bpastel[\s-]?pink\b/, "pastel pink"],
  [/\bpastel[\s-]?green\b/, "pastel green"],
  [/\bpastel[\s-]?blue\b/, "pastel blue"],
  [/\brose[\s-]?gold\b/, "rose gold"],
  [/\bdark[\s-]?green\b/, "dark green"],
  [/\bdark[\s-]?blue\b/, "dark blue"],
];

const COLOR_DB_ALIASES = {
  // Keep DB filtering exact. Query parsers already normalize words like safed->white.
};

function expandColorTermsForDb(colors = []) {
  const expanded = new Set();
  colors.forEach(color => {
    const clean = String(color || "").toLowerCase().trim();
    if (!clean) return;
    expanded.add(clean);
    (COLOR_DB_ALIASES[clean] || []).forEach(alias => expanded.add(alias));
  });
  return [...expanded];
}

function parseColorsFromQuery(query) {
  const q = (query || "").toLowerCase();
  const found = [];
  COMPOUND_COLORS.forEach(([re, color]) => {
    if (re.test(q) && !found.includes(color)) found.push(color);
  });
  q.split(/\s+/).forEach(word => {
    const clean = word.replace(/[^a-z]/g, "");
    if (clean.length < 3) return;
    const normalized = QUERY_COLORS.get(clean);
    if (normalized && !found.includes(normalized)) found.push(normalized);
  });
  return found; // e.g. ["black"] or ["off-white", "golden"]
}

function parseColorPrefixesFromQuery(query) {
  const token = String(query || "").toLowerCase().trim().replace(/[^a-z]/g, "");
  if (token.length < 3 || token.includes(" ")) return [];
  const matches = new Set();
  QUERY_COLORS.forEach((color, word) => {
    if (word.startsWith(token) || color.startsWith(token)) {
      matches.add(color);
    }
  });
  return [...matches];
}

const QUERY_OCCASIONS = new Map([
  ["shadi", "wedding"], ["shaadi", "wedding"], ["wedding", "wedding"],
  ["barat", "wedding"], ["baraat", "wedding"], ["valima", "wedding"], ["waleema", "wedding"],
  ["nikah", "wedding"], ["nikkah", "wedding"], ["bridal", "wedding"], ["dulhan", "wedding"],
  ["mehndi", "mehndi"], ["mayun", "mehndi"],
  ["dawat", "party"], ["dinner", "party"], ["party", "party"], ["function", "party"],
  ["eid", "festive"], ["festive", "festive"],
  ["office", "formal"], ["daftar", "formal"], ["formal", "formal"],
  ["daily", "casual"], ["rozana", "casual"], ["casual", "casual"], ["university", "casual"]
]);

const OCCASION_DB_SYNONYMS = {
  wedding: ["bridal", "wedding", "barat", "valima", "shadi", "formal", "couture"],
  mehndi: ["mehndi", "mehendi", "festive", "yellow"],
  party: ["party", "formal", "evening", "festive", "function"],
  festive: ["festive", "eid", "celebration", "party"],
  formal: ["formal", "formals", "semi formal", "office"],
  casual: ["casual", "lawn", "pret", "daily wear"]
};

function parseOccasionsFromQuery(query) {
  const q = (query || "").toLowerCase();
  const found = new Set();
  for (const [word, occasion] of QUERY_OCCASIONS.entries()) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
    if (re.test(q)) found.add(occasion);
  }
  return [...found];
}

function normalizeColorParamValues(value) {
  const raw = Array.isArray(value) ? value : (value === undefined ? [] : [value]);
  return raw
    .flatMap(v => String(v || "").split(","))
    .map(v => String(v || "")
      .toLowerCase()
      .replace(/\(\s*\d+\s*\)/g, "")
      .replace(/\b\d+\b/g, "")
      .trim())
    .map(v => QUERY_COLORS.get(v) || v)
    .filter(Boolean);
}

// =========================
// 💰 MIN PRICE PARSER
// "above 5000", "over 10k", "5000 to 15000", "50k se upar"
// =========================
function parseMinPriceFromQuery(query) {
  const q = (query || "").toLowerCase();

  // "above/over X k"
  const aboveK = q.match(/(?:above|over|more\s*than|se\s*upar|se\s*zyada|minimum|min)\s*(\d+)\s*k\b/);
  if (aboveK) return parseInt(aboveK[1], 10) * 1000;

  // "above/over X" (plain 3+ digit number)
  const abovePlain = q.match(/(?:above|over|more\s*than|se\s*upar|se\s*zyada|minimum|min)\s*(\d{3,})/);
  if (abovePlain) return parseInt(abovePlain[1], 10);

  // "X k to/se/- Y k" → min = X * 1000
  const rangeKK = q.match(/(\d+)\s*k\s*(?:to|se|-)\s*\d+\s*k/);
  if (rangeKK) return parseInt(rangeKK[1], 10) * 1000;

  // "X to/- Y" plain 3+ digit → min = X
  const rangePlain = q.match(/(\d{3,})\s*(?:to|-)\s*\d{3,}/);
  if (rangePlain) return parseInt(rangePlain[1], 10);

  return null;
}

// =========================
// 💡 BUILD SUGGESTIONS
// Cleans AI related terms — strips any price noise the AI sneaked in,
// removes terms identical to the original query, deduplicates.
// =========================
const SUGGESTION_PRICE_RE = /\b(?:under|below|above|over|less\s*than|se\s*kam|tak|mein)\s*[\d]+[kK]?|\b\d+[kK]\b|\b\d{4,}\b/gi;

function buildSuggestions(aiExpansion, originalQuery) {
  if (!aiExpansion?.related?.length) return [];

  const seen = new Set([originalQuery.toLowerCase().trim()]);
  const results = [];

  for (const raw of aiExpansion.related) {
    const cleaned = (raw || "")
      .replace(SUGGESTION_PRICE_RE, "")   // strip "under 150k", "150000" etc.
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (cleaned.length < 3) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    results.push({ text: cleaned, type: "ai" });
    if (results.length >= 6) break;
  }

  return results;
}

// =========================
// AI SUGGESTIONS (Groq Llama)
// Autocomplete-style completions as user types
// =========================

const suggestionsCache = {};
const SUGGESTIONS_CACHE_TTL = 1000 * 45; // 45 sec

async function _callSuggestionsModel(prompt, modelName, apiKey, maxTokens = 120, temperature = 0.3) {
  try {
    const response = await Promise.race([
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
    ]);
    if (response.status === 429) { console.warn(`[Suggestions] ${modelName} rate limited`); return null; }
    const json = await response.json();
    if (json?.error) { console.warn(`[Suggestions] ${modelName} error:`, json.error?.message); return null; }
    const text = (json?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.warn(`[Suggestions] ${modelName} no JSON found`); return null; }
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn(`[Suggestions] ${modelName} exception:`, e.message);
    return null;
  }
}

async function getAiSuggestions(query, modelName = AI_FALLBACK_MODEL) {
  const key = query.toLowerCase().trim();
  const cached = suggestionsCache[key];
  if (cached && Date.now() - cached.timestamp < SUGGESTIONS_CACHE_TTL) {
    return cached.data;
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return [];

    const prompt = `You are an autocomplete assistant for a South Asian fashion e-commerce store.

Customer typed: "${query}"

Generate 5 natural search completions as dropdown suggestions.

Return ONLY this JSON (no explanation):
{"suggestions":["<s1>","<s2>","<s3>","<s4>","<s5>"]}

Rules:
- Each suggestion: complete short query, 2-5 words, English only
- Stay within the SAME occasion/category the customer is typing about
- Cover: product type, fabric, color, occasion variations — within scope
- Pakistani/South Asian fashion context only
- DO NOT suggest bridal/wedding for casual/party queries and vice versa

Occasion-scoped examples:
"party" → ["party wear dress","formal party outfit","chiffon party suit","evening party dress","dinner party outfit"]
"mehndi" → ["mehndi function dress","mehndi outfit yellow","mehndi lehenga","colorful mehndi dress","mehndi gharara set"]
"bridal" → ["bridal lehenga heavy","bridal collection designer","barat outfit bridal","heavy embroidered bridal","bridal gharara set"]
"maria" → ["maria b lawn","maria b pret","maria b eid collection","maria b formal","maria b winter collection"]
"casual" → ["casual cotton kurti","casual lawn suit","daily wear kurti","casual printed dress","casual pret outfit"]
"dinner" → ["dinner party outfit","formal dinner dress","elegant dinner wear","chiffon dinner suit","dinner event outfit"]`;

    let parsed = await _callSuggestionsModel(prompt, modelName, apiKey);
    if (!parsed && modelName !== AI_FALLBACK_MODEL) {
      parsed = await _callSuggestionsModel(prompt, AI_FALLBACK_MODEL, apiKey);
    }
    // DeepSeek/Gemini fallback disabled for suggestions.
    if (!parsed) return [];

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
        .map(s => (s || "").toLowerCase().trim())
        .filter(s => s.length >= 3 && s.length <= 60)
        .slice(0, 5)
      : [];

    suggestionsCache[key] = { data: suggestions, timestamp: Date.now() };
    return suggestions;
  } catch (err) {
    console.error("AI suggestions error:", err.message);
    return [];
  }
}

const normalizeDomain = (domain) =>
  (domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

const escapeRegex = (value) =>
  String(value).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
const normalizeVendorName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeId = (id) =>
  String(id || "").replace("gid://shopify/Collection/", "").trim();

const toTime = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const latestProductTime = (product = {}) =>
  // firstPublishedAt is the stable "new arrival" signal.
  // Shopify createdAt is only a fallback for old/migrated docs with missing publish dates.
  toTime(product.firstPublishedAt) ||
  toTime(product.shopifyPublishedAt) ||
  toTime(product.publishedAt) ||
  toTime(product.shopifyCreatedAt);

const latestCollectionTime = (collection = {}) => {
  // Take the MORE RECENT of shopifyCreatedAt and firstPublishedAt
  // shopifyCreatedAt: stable Shopify creation date (never changes)
  // firstPublishedAt: first publish date ($setOnInsert, never overwritten)
  // Neither changes on republish — both are safe signals
  return (
    toTime(collection.shopifyPublishedAt) ||
    toTime(collection.publishedAt) ||
    toTime(collection.firstPublishedAt) ||
    toTime(collection.shopifyCreatedAt)
  );
};

const daysSinceTime = (time) =>
  time
    ? (Date.now() - time) / (1000 * 60 * 60 * 24)
    : 9999;

// Words that are generic fashion / occasion keywords — never use as vendor signals.
// If a query token is in this set it won't drive vendor detection via typo or token scoring.
// Exact/contains matches on the full vendor name still work (e.g. vendor "Shadi Studio").
const NON_VENDOR_KEYWORDS = new Set([
  // Pakistani occasions
  "shadi", "mehndi", "barat", "baraat", "valima", "waleema", "nikah", "mangni",
  "engagement", "mayun", "eid", "party", "festive",
  // Lifestyle / category
  "casual", "formal", "office", "university", "college", "bridal", "wedding", "bride", "dulhan",
  // Product types
  "lawn", "suit", "suits", "kurti", "kurtis", "kameez", "lehenga", "gharara", "sharara",
  "saree", "sari", "maxi", "gown", "kaftan", "pret", "unstitched", "stitched",
  "dress", "dresses", "jora", "dupatta", "collection", "collections",
  "outfit", "outfits", "clothes", "clothing", "attire", "wear", "wearing",
  // Seasons & occasions (generic)
  "summer", "winter", "spring", "autumn", "seasonal", "eid", "festive",
  // Fabrics
  "chiffon", "silk", "cotton", "organza", "velvet", "khaddar", "karandi",
  "georgette", "net", "tissue", "jacquard",
  // Descriptors
  "embroidered", "embroidery", "printed", "digital", "luxury", "designer",
  "heavy", "light", "new", "arrivals", "arrival", "sale", "discount", "latest",
  "style", "styles", "fashion", "trendy", "elegant", "beautiful", "pretty",
  "classic", "modern", "traditional", "ethnic", "western", "eastern",
  // Generic filler words
  "for", "with", "and", "the", "best", "top", "good", "nice", "similar",
  // Colors
  "red", "blue", "green", "black", "white", "pink", "yellow", "orange",
  "purple", "maroon", "navy", "grey", "gray", "beige", "cream", "golden",
]);

// Collections that are internal Shopify system/app collections — never show to users
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
  /filter[\s-]?index/i,
  /^all[\s-]?products$/i,
  /^new[\s-]?arrivals$/i,
  /^\d{4}$/,           // just a year: "2026"
  /^[.\-_\s]+$/,       // just punctuation: ".", "-"
];

const isGarbageCollection = (title) => {
  const t = (title || "").trim();
  if (t.length < 3) return true;
  return GARBAGE_COLLECTION_PATTERNS.some(p => p.test(t));
};

const GARBAGE_VENDOR_PATTERNS = [
  /^add[\s-]?ons?$/i,
  /^addons?$/i,
  /^custom/i,
  /^default/i,
  /^test/i,
  /^unknown$/i,
  /^vendor$/i,
  /^[.\-_\s]+$/,
  /^\d+$/
];

const isGarbageVendor = (name) => {
  const t = String(name || "").trim();
  if (t.length < 2) return true;
  return GARBAGE_VENDOR_PATTERNS.some(p => p.test(t));
};

const recencyScore = (time, weights = {}) => {
  const daysOld = daysSinceTime(time);

  if (daysOld <= 1) return weights.day1 ?? 45000;
  if (daysOld <= 3) return weights.day3 ?? 35000;
  if (daysOld <= 7) return weights.day7 ?? 25000;
  if (daysOld <= 30) return weights.day30 ?? 12000;
  if (daysOld <= 90) return weights.day90 ?? 4000;
  if (daysOld <= 180) return weights.day180 ?? 1000;

  return 0;
};

// POST /api/stores/add

router.post("/stores/add", async (req, res) => {
  const { storeName, domain, accessToken } = req.body;

  try {
    const newStore = await Store.create({
      storeName,
      domain,
      accessToken
    });

    res.json({ success: true, store: newStore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const settingsCache = {};
const filterConfigCache = {};
const FILTER_CONFIG_CACHE_TTL = 1000 * 60;
const SETTINGS_CACHE_TTL = 1000 * 60; // 1 min — fast refresh when admin updates options

const getSearchSettings = async (shop) => {
  const cached = settingsCache[shop];
  if (cached && Date.now() - cached.timestamp < SETTINGS_CACHE_TTL) {
    return cached.data;
  }
  const doc = await Settings.findOne({ shop }).lean();
  const data = {
    searchSettings: doc?.searchSettings || {},
    searchOptions: doc?.searchOptions || {},
    aiSettings: doc?.aiSettings || {},
    filters: doc?.filters || {},
    country: doc?.country || "Pakistan"
  };
  settingsCache[shop] = { data, timestamp: Date.now() };
  return data;
};

const normalizeActiveFilterKey = (f) => ({
  collections: "collection",
  collection_id: "collection",
  color_swatch: "color",
  colors: "color",
  colour: "color",
  colours: "color",
  sizes: "size",
  variant_option: "size",
  product_type: "productType",
  type: "productType",
  brand: "vendor",
  brands: "vendor",
  stock: "availability",
  in_stock: "availability",
  category: "tag"
}[f] || f);

const getActiveFilterConfig = async (shop) => {
  const cached = filterConfigCache[shop];
  if (cached && Date.now() - cached.timestamp < FILTER_CONFIG_CACHE_TTL) return cached.data;

  const customFilters = await Filter.find({ shop })
    .select("filterType status visibility settings.enabled")
    .lean()
    .maxTimeMS(1000);

  const usesCustomFilters = customFilters.length > 0;
  const activeFilterKeys = customFilters
    .filter(filter =>
      filter.status === "active" &&
      filter.visibility === "visible" &&
      filter.settings?.enabled !== false
    )
    .map(filter => normalizeActiveFilterKey(filter.filterType));

  const data = { usesCustomFilters, activeFilters: new Set(activeFilterKeys) };
  filterConfigCache[shop] = { data, timestamp: Date.now() };
  return data;
};

// =========================
// 🔥 VENDOR CACHE
// =========================

const vendorCache = {};
const searchCache = {};
const SEARCH_CACHE_TTL = 1000 * 60;
const SEARCH_CACHE_MAX = 500;
const SEARCH_RANKING_VERSION = "filters-fast-cache-v2";
const CACHE_TIME = 1000 * 60 * 2;

// Trending routes cache — results change slowly, 3-min TTL is fine
const trendingCache = {};
const TRENDING_CACHE_TTL = 1000 * 60 * 3;

// =========================
// 🌤️ SEASONAL AI SUGGESTIONS
// Pakistan seasons: Jun-Sep=summer, Dec-Feb=winter, Mar-May=spring, Oct-Nov=autumn
// =========================
const seasonalSuggestionsCache = {};
const SEASONAL_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours — season doesn't change fast

function getPakistanSeason() {
  const m = new Date().getMonth(); // 0=Jan
  if (m >= 5 && m <= 8) return "summer";
  if (m >= 11 || m <= 1) return "winter";
  if (m >= 2 && m <= 4) return "spring";
  return "autumn";
}

async function getSeasonalSuggestions(modelName = AI_FALLBACK_MODEL) {
  const season = getPakistanSeason();
  const year = new Date().getFullYear();
  const cached = seasonalSuggestionsCache[season];
  if (cached && Date.now() - cached.timestamp < SEASONAL_CACHE_TTL) {
    return cached.data;
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return [];

    const ctx = {
      summer: `hot summer ${year}. Lawn suits, cotton, light printed fabric, summer collection ${year}.`,
      winter: `cold winter ${year}. Khaddar, velvet, warm embroidered suits, winter collection.`,
      spring: `spring and Eid ${year} shopping. Eid outfits, new lawn launches, light formal, pret.`,
      autumn: `autumn/pre-winter ${year}. Transitional fabrics, khaddar starting, light warm suits.`
    }[season];

    const prompt = `You are an AI for a fashion e-commerce store.
Current season: ${season} ${year}. Context: ${ctx}

Generate 6 short trending fashion search suggestions for RIGHT NOW in ${year}.
IMPORTANT:
- Write ALL suggestions in English only.
- Use year ${year} if mentioning a year — NEVER use past years like 2024 or 2023.

Return ONLY this JSON (no explanation):
{"suggestions":["<s1>","<s2>","<s3>","<s4>","<s5>"]}

Rules: 2-5 words each, English only, season-relevant, fashion only.`;

    let parsed = await _callSuggestionsModel(prompt, modelName, apiKey, 120, 0.4);
    if (!parsed && modelName !== AI_FALLBACK_MODEL) {
      parsed = await _callSuggestionsModel(prompt, AI_FALLBACK_MODEL, apiKey, 120, 0.4);
    }
    if (!parsed) return [];
    // Strip any stale year the AI sneaked in (anything < current year)
    const staleYearRe = new RegExp(`\\b20(?:2[0-${String(year - 1).slice(-1)}]|[0-1]\\d)\\b`, "g");
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
        .map(s => (s || "").toLowerCase().trim().replace(staleYearRe, String(year)))
        .filter(s => s.length >= 3 && s.length <= 60)
        .slice(0, 6)
      : [];

    seasonalSuggestionsCache[season] = { data: suggestions, timestamp: Date.now() };
    return suggestions;
  } catch (err) {
    console.error("Seasonal suggestions error:", err.message);
    return [];
  }
}
router.get("/search", async (req, res) => {

  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const __reqStart = Date.now();

    let {
      q,
      shop,
      vendor: filterVendor,
      brand: filterBrand,
      brands: filterBrands,
      minPrice: filterMinPrice,
      min_price: filterMinPriceAlt,
      maxPrice: filterMaxPrice,
      max_price: filterMaxPriceAlt,
      color: filterColor,
      colors: filterColors,
      colour: filterColour,
      colours: filterColours,
      tag: filterTag,
      tags: filterTags,
      collection: filterCollection,
      collections: filterCollections,
      collection_id: filterCollectionId,
      collectionId: filterCollectionIdAlt,
      size: filterSize,
      sizes: filterSizes,
      productType: filterProductType,
      product_type: filterProductTypeAlt,
      type: filterType,
      availability: filterAvailability,
      stock: filterStock,
      page: requestedPage,
      limit: requestedLimit,
      perPage: requestedPerPage,
      per_page: requestedPerPageAlt
    } = req.query;
    searchDebug(`[SEARCH] hit -> shop:${shop} q:${q}`);

    // =========================
    // 🔥 CLEAN INPUTS
    // =========================
    shop = (shop || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .trim()
      .toLowerCase();
    const cleanStore = shop;
    q = (q || "").trim();

    const originalQuery =
      q.toLowerCase();
    const requestedColorFilter = filterColor || filterColors || filterColour || filterColours ||
      req.query["color[]"] || req.query["colors[]"] || req.query["filter[color]"] || req.query["filter[colors]"];
    const requestedVendorFilter = filterVendor || filterBrand || filterBrands ||
      req.query["vendor[]"] || req.query["brand[]"] || req.query["filter[vendor]"] || req.query["filter[brand]"];
    const requestedMinPrice = filterMinPrice || filterMinPriceAlt || req.query["filter[minPrice]"] || req.query["filter[min_price]"];
    const requestedMaxPrice = filterMaxPrice || filterMaxPriceAlt || req.query["filter[maxPrice]"] || req.query["filter[max_price]"];
    const requestedTagFilter = filterTag || filterTags ||
      req.query["tag[]"] || req.query["tags[]"] || req.query["filter[tag]"] || req.query["filter[tags]"];
    const requestedCollectionFilter = filterCollection || filterCollections || filterCollectionId || filterCollectionIdAlt ||
      req.query["collection[]"] || req.query["collections[]"] || req.query["filter[collection]"] || req.query["filter[collections]"];
    const requestedSizeFilter = filterSize || filterSizes ||
      req.query["size[]"] || req.query["sizes[]"] || req.query["filter[size]"] || req.query["filter[sizes]"];
    const requestedProductTypeFilter = filterProductType || filterProductTypeAlt || filterType ||
      req.query["productType[]"] || req.query["product_type[]"] || req.query["filter[productType]"] || req.query["filter[product_type]"];
    const requestedAvailabilityFilter = filterAvailability || filterStock ||
      req.query["availability[]"] || req.query["stock[]"] || req.query["filter[availability]"] || req.query["filter[stock]"];
    const hasRequestedFilters = Boolean(
      requestedVendorFilter ||
      requestedMinPrice ||
      requestedMaxPrice ||
      requestedColorFilter ||
      requestedTagFilter ||
      requestedCollectionFilter ||
      requestedSizeFilter ||
      requestedProductTypeFilter ||
      requestedAvailabilityFilter
    );
    const includeCollections =
      req.query.includeCollections === "true" ||
      req.query.includeCollections === "1" ||
      req.query.include === "collections";

    const currentPage = Math.max(parseInt(requestedPage, 10) || 1, 1);
    const pageLimit = Math.min(Math.max(parseInt(requestedLimit || requestedPerPage || requestedPerPageAlt, 10) || 48, 48), 48);
    const pageOffset = (currentPage - 1) * pageLimit;
    const paginatePayload = (payload) => {
      const allProducts = Array.isArray(payload.products) ? payload.products : [];
      const totalProducts = Number(payload.meta?.totalProducts ?? allProducts.length);
      const totalPages = Math.max(Math.ceil(totalProducts / pageLimit), 1);
      const pagedProducts = allProducts.slice(pageOffset, pageOffset + pageLimit).slice(0, pageLimit);
      return {
        ...payload,
        meta: {
          ...(payload.meta || {}),
          totalProducts,
          returnedProducts: pagedProducts.length,
          enforcedLimit: pageLimit,
          pagination: {
            page: currentPage,
            limit: pageLimit,
            offset: pageOffset,
            totalProducts,
            returnedProducts: pagedProducts.length,
            totalPages,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1,
            nextPage: currentPage < totalPages ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null
          }
        },
        products: pagedProducts
      };
    };

    if (!shop) {

      return res.json({
        query: q,
        meta: {},
        vendors: [],
        collections: [],
        products: [],
        suggestions: []
      });

    }

    if (!q && !hasRequestedFilters) {

      const latestProducts =
        await Product.find({
          store: cleanStore,
          status: "ACTIVE"
        })
          .sort({
            firstPublishedAt: -1,
            shopifyPublishedAt: -1,
            publishedAt: -1,
            shopifyCreatedAt: -1
          })
          .skip(pageOffset)
          .limit(pageLimit)
          .lean();

      return res.json({
        query: "",
        meta: {
          emptySearch: true,
          totalProducts: latestProducts.length,
          pagination: {
            page: currentPage,
            limit: pageLimit,
            offset: pageOffset,
            totalProducts: latestProducts.length,
            totalPages: currentPage,
            hasNextPage: latestProducts.length === pageLimit,
            hasPrevPage: currentPage > 1,
            nextPage: latestProducts.length === pageLimit ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null
          }
        },
        vendors: [],
        collections: [],
        products: latestProducts,
        suggestions: []
      });

    }

    // Single-character queries are noise — skip DB entirely
    if (q && q.length < 3 && !hasRequestedFilters) {
      const shortRegex = new RegExp(`^${escapeRegex(q)}`, "i");
      const shortProductRegex = new RegExp(`(^|\\s)${escapeRegex(q)}`, "i");
      const vendors = await Product.aggregate([
        {
          $match: {
            store: cleanStore,
            status: "ACTIVE",
            vendor: { $regex: shortRegex }
          }
        },
        {
          $group: {
            _id: "$vendor",
            latestDate: {
              $max: {
                $ifNull: [
                  "$firstPublishedAt",
                  { $ifNull: ["$shopifyPublishedAt", "$shopifyCreatedAt"] }
                ]
              }
            }
          }
        },
        { $limit: 50 }
      ]);

      const queryText = q.toLowerCase();
      const formattedVendors = vendors
        .filter(v => v._id && !isGarbageVendor(v._id))
        .map(v => {
          const title = String(v._id || "");
          const normalized = title.toLowerCase();
          let score = 1000;
          if (normalized.startsWith(queryText)) score += 50000;
          return {
            title,
            type: "vendor",
            score,
            latestDate: v.latestDate || null
          };
        })
        .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
        .slice(0, 10);

      const shortProductsRaw = await Product.find({
        store: cleanStore,
        status: "ACTIVE",
        $or: [
          { vendor: { $regex: shortRegex } },
          { title: { $regex: shortProductRegex } },
          { productType: { $regex: shortProductRegex } }
        ]
      })
        .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .skip(pageOffset)
        .limit((pageLimit * 5) + 1)
        .lean()
        .select(`
          productId title handle vendor image price stock productType
          colors sizes tags collections status
          firstPublishedAt shopifyPublishedAt publishedAt shopifyCreatedAt
        `);

      const filteredShortProductsRaw = shortProductsRaw.filter(p => !isGarbageVendor(p.vendor));
      const hasNextPage = filteredShortProductsRaw.length > pageLimit;
      const shortProducts = filteredShortProductsRaw.slice(0, pageLimit).map(p => {
        const latestTime = latestProductTime(p);
        return {
          ...p,
          latestTime,
          latestDate: latestTime ? new Date(latestTime) : null,
          score: String(p.vendor || "").toLowerCase().startsWith(queryText) ? 50000 : 10000
        };
      });
      const shortTotalEstimate = pageOffset + shortProducts.length + (hasNextPage ? 1 : 0);

      return res.json({
        query: q,
        meta: {
          shortQuery: true,
          aiSkipped: true,
          totalProducts: shortTotalEstimate,
          pagination: {
            page: currentPage,
            limit: pageLimit,
            offset: pageOffset,
            totalProducts: shortTotalEstimate,
            totalPages: hasNextPage ? currentPage + 1 : currentPage,
            hasNextPage,
            hasPrevPage: currentPage > 1,
            nextPage: hasNextPage ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null
          }
        },
        vendors: formattedVendors,
        collections: [],
        products: shortProducts,
        suggestions: []
      });
    }

    const normalizeParamList = (value) => {
      const raw = Array.isArray(value) ? value : (value === undefined ? [] : [value]);
      return raw
        .flatMap(v => String(v || "").split(","))
        .map(v => v.trim())
        .filter(Boolean);
    };
    const filterStateForCache = {
      vendor: normalizeParamList(requestedVendorFilter).sort(),
      minPrice: requestedMinPrice || "",
      maxPrice: requestedMaxPrice || "",
      color: normalizeColorParamValues(requestedColorFilter).sort(),
      tag: normalizeParamList(requestedTagFilter).sort(),
      collection: normalizeParamList(requestedCollectionFilter).sort(),
      size: normalizeParamList(requestedSizeFilter).sort(),
      productType: normalizeParamList(requestedProductTypeFilter).sort(),
      availability: normalizeParamList(requestedAvailabilityFilter).sort()
    };

    // Cache by query + filters so filtered result sets do not leak into each other.
    const cacheKey = `${SEARCH_RANKING_VERSION}|${cleanStore}|${originalQuery}|page:${currentPage}|limit:${pageLimit}|collections:${includeCollections ? 1 : 0}|${JSON.stringify(filterStateForCache)}`;
    const cachedSearch = searchCache[cacheKey];
    if (cachedSearch && Date.now() - cachedSearch.timestamp < SEARCH_CACHE_TTL) {
      return res.json(paginatePayload(cachedSearch.data));
    }

    // =========================
    // 🔥 SETTINGS + PARALLEL DB PREFETCH
    // Settings load first (cached — near-zero cost) so correct AI model + enabled flag is known
    // =========================
    const vendorCacheHit =
      vendorCache[shop] &&
      Date.now() - vendorCache[shop].timestamp < CACHE_TIME;

    const [settingsData, customFilterConfig, synonymData, boosts, rawVendors] = await Promise.all([
      getSearchSettings(shop),
      getActiveFilterConfig(shop),
      Synonym.findOne({ query: originalQuery, store: shop }).lean(),
      Boost.find({ query: originalQuery, store: shop }).lean(),
      vendorCacheHit
        ? Promise.resolve(null)
        : Product.distinct("vendor", { store: shop, status: "ACTIVE" })
    ]);
    const searchSettings = settingsData.searchSettings || {};
    const searchOpts = settingsData.searchOptions || {};
    const aiSettings = settingsData.aiSettings || {};
    const filterSettings = settingsData.filters || {};
    const filtersEnabled = filterSettings.enabled !== false;
    const { usesCustomFilters } = customFilterConfig;
    const activeFilters = usesCustomFilters
      ? customFilterConfig.activeFilters
      : new Set((filterSettings.active || []).map(normalizeActiveFilterKey));
    const isFilterActive = (name) =>
      filtersEnabled && (usesCustomFilters ? activeFilters.has(name) : (activeFilters.size === 0 || activeFilters.has(name)));
    const hideOutOfStock = filtersEnabled && filterSettings.hideOutOfStock === true;
    const storedModel = aiSettings.geminiModel;
    const aiModelName = storedModel && SAFE_EXPANSION_MODELS.has(storedModel)
      ? storedModel
      : AI_PRIMARY_MODEL;
    const aiEnabled = aiSettings.geminiEnabled !== false;
    const parsedExactColors = parseColorsFromQuery(originalQuery);
    const localColors = parsedExactColors.length ? parsedExactColors : parseColorPrefixesFromQuery(originalQuery);
    const localOccasions = parseOccasionsFromQuery(originalQuery);
    const localMinPrice = parseMinPriceFromQuery(originalQuery);
    const localMaxPrice = parseMaxPriceFromQuery(originalQuery);
    const aiQueryTokens = originalQuery.split(/\s+/).filter(Boolean);
    const oneTokenQuery = aiQueryTokens.length === 1;
    const directColorQuery = oneTokenQuery && localColors.length > 0;
    const hasPriceIntent = Boolean(localMinPrice || localMaxPrice);
    const hasSemanticIntent = localOccasions.length > 0 || hasPriceIntent;
    const shouldRunAiExpansion =
      aiEnabled &&
      Boolean(process.env.GROQ_API_KEY) &&
      originalQuery.length >= 4 &&
      !hasRequestedFilters &&
      !oneTokenQuery &&
      !directColorQuery &&
      (
        hasSemanticIntent ||
        aiQueryTokens.length >= 3
      );

    // =========================
    // 🤖 AI CALL — settings loaded, fire with correct model + only if enabled
    // =========================
    searchDebug(`[AI] ${shouldRunAiExpansion ? "Run" : "Skip"} -> aiEnabled:${aiEnabled} | key:${!!process.env.GROQ_API_KEY} | model:${aiModelName} | qLen:${originalQuery.length}`);
    if (!aiEnabled) console.warn("[AI] DISABLED — set geminiEnabled:true via PUT /api/admin/ai-settings");

    const storeCtx = vendorCacheHit ? { vendors: vendorCache[shop].data } : {};
    const aiExpansionPromise = shouldRunAiExpansion
      ? getAiExpansion(originalQuery, aiModelName, storeCtx)
      : Promise.resolve(null);

    // =========================
    // 🔥 APPLY SYNONYM
    // =========================
    const synonymsEnabled = searchSettings.synonymsEnabled !== false;
    const synonymWords = synonymsEnabled
      ? (synonymData?.synonyms || [])
        .map(s => s.word?.toLowerCase().trim())
        .filter(Boolean)
      : [];

    const finalQuery = synonymWords.length > 0 ? synonymWords[0] : originalQuery;
    let allSearchTerms = [...new Set([originalQuery, ...synonymWords])];

    // =========================
    // 🤖 APPLY AI EXPANSION
    // DB queries done — Groq likely already responded by now
    // =========================
    const aiExpansion = await Promise.race([
      aiExpansionPromise,
      new Promise(resolve => setTimeout(() => resolve(null), AI_SEARCH_BLOCKING_BUDGET_MS))
    ]);

    if (aiExpansion) {
      if (aiExpansion.corrected && aiExpansion.corrected !== originalQuery) {
        allSearchTerms = [aiExpansion.corrected, ...allSearchTerms];
      }
      allSearchTerms = [...new Set(allSearchTerms)];
    }

    // =========================
    // 🎨 COLOR + PRODUCT TYPE EXTRACTION
    // Local parsers run on raw query (no AI needed — fast + reliable).
    // AI values fill in when local parsing misses something.
    // =========================
    const selectedColorTerms = isFilterActive("color")
      ? normalizeColorParamValues(requestedColorFilter)
      : [];
    const hardColorTerms = [...new Set([...localColors, ...selectedColorTerms]
      .map(c => String(c || "").toLowerCase().trim())
      .filter(Boolean))];
    const dbColorTerms = expandColorTermsForDb(hardColorTerms);
    const aiColorTerms = (aiExpansion?.colors?.length ? aiExpansion.colors : (aiExpansion?.color ? [aiExpansion.color] : []))
      .map(c => String(c || "").toLowerCase().trim())
      .filter(Boolean);

    // Prefer explicit query/filter colors for hard filtering. AI colors are soft scoring only.
    const effectiveColors = hardColorTerms.length
      ? hardColorTerms
      : aiColorTerms;
    const colorOnlySearch = oneTokenQuery && hardColorTerms.length > 0 && !hasRequestedFilters;

    // Add English color translations to allSearchTerms so Urdu color words (lal, kala)
    // also find products tagged/titled in English
    if (effectiveColors.length) {
      effectiveColors.forEach(c => {
        if (!allSearchTerms.includes(c)) allSearchTerms.push(c);
      });
      allSearchTerms = [...new Set(allSearchTerms)];
    }

    // AI product/category/occasion signals stay in scoring only. Hard DB fetch must
    // stay anchored to user query, selected filters, and local explicit parsers.

    // =========================
    // 🔥 BOOSTS
    // =========================
    const boostedIds = boosts.map(b => String(b.productId));

    // =========================
    // 🔥 VENDORS
    // =========================
    let uniqueVendors;
    if (vendorCacheHit) {
      uniqueVendors = vendorCache[shop].data;
    } else {
      uniqueVendors = (rawVendors || []).filter(Boolean).map(v => v.trim());
      vendorCache[shop] = { data: uniqueVendors, timestamp: Date.now() };
    }

    // =========================
    // 🔥 NORMALIZE QUERY
    // =========================
    // Always use original query for vendor detection + scoring.
    // Synonyms expand search via allSearchTerms — they don't replace the query.
    const normalizedQuery = originalQuery;

    // =========================
    // 🔥 DETECT BEST VENDOR
    // =========================

    let detectedVendor = null;

    const vendorMatches = uniqueVendors
      .map(v => {

        const vendorName =
          normalizeVendorName(v);

        const normalizedVendorQuery =
          normalizeVendorName(normalizedQuery);

        let score = 0;

        // EXACT MATCH
        if (
          vendorName === normalizedVendorQuery
        ) {
          score += 100000;
        }

        // STARTS WITH
        if (
          normalizedVendorQuery &&
          vendorName.startsWith(normalizedVendorQuery)
        ) {
          score += 50000;
        }

        // CONTAINS
        if (
          normalizedVendorQuery &&
          vendorName.includes(normalizedVendorQuery)
        ) {
          score += 20000;
        }

        // TYPO TOLERANCE
        // First character MUST match — prevents "shadi"→"arshad" false positives.
        // Generic fashion/occasion keywords are skipped — they are never vendor signals.
        const queryTokens =
          normalizedVendorQuery.split(" ").filter(Boolean);

        const vendorTokens =
          vendorName.split(" ").filter(Boolean);

        // Generic Keyword for Fashion
        const GENERIC_FASHION_WORDS = new Set([
          "formal",
          "formals",
          "dress",
          "dresses",
          "lawn",
          "pret",
          "luxury",
          "bridal",
          "bridals",
          "eid",
          "summer",
          "winter",
          "collection",
          "collections",
          "suit",
          "suits",
          "kurta",
          "kurti",
          "co",
          "coord",
          "co-ord"
        ]);

        const nonGenericQueryTokens = queryTokens.filter(
          qt =>
            !NON_VENDOR_KEYWORDS.has(qt) &&
            !GENERIC_FASHION_WORDS.has(qt)
        );

        nonGenericQueryTokens.forEach(qt => {
          vendorTokens.forEach(vt => {
            if (!qt || !vt || qt[0] !== vt[0]) return;
            const sim = stringSimilarity.compareTwoStrings(qt, vt);
            // if (sim > 0.70)
            if (sim > 0.60) {
              score += sim * 20000;
            }
          });
        });

        // TOKEN MATCHES — full token must appear in vendor name
        nonGenericQueryTokens.forEach(token => {
          if (token.length >= 3 && vendorName.includes(token)) {
            score += 5000;
          }
        });

        // Coverage penalty: if vendor name is much longer than matched query tokens,
        // reduce score — prevents single short word from matching long vendor names
        if (score > 0) {
          const matchedTokens = nonGenericQueryTokens.filter(qt =>
            vendorTokens.some(vt =>
              stringSimilarity.compareTwoStrings(qt, vt) > 0.75 ||
              vendorName.includes(qt)
            )
          );

          // Agar query ka koi token vendor se match kar gaya
          // to vendor ko punish mat karo
          if (matchedTokens.length === 0) {
            score = Math.floor(score * 0.4);
          }
        }

        return { vendor: v, score };
      })
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score);

    if (vendorMatches.length && vendorMatches[0].score > 10000) {
      detectedVendor = vendorMatches[0].vendor;
    }

    if (!detectedVendor && requestedVendorFilter && isFilterActive("vendor")) {
      const requestedVendor = normalizeVendorName(normalizeParamList(requestedVendorFilter)[0]);
      const filterVendorMatch = uniqueVendors.find(v =>
        normalizeVendorName(v) === requestedVendor ||
        normalizeVendorName(v).includes(requestedVendor)
      );
      if (filterVendorMatch) detectedVendor = filterVendorMatch;
    }

    // =========================
    // 🤖 AI BRAND HINT FALLBACK
    // Normal vendor detection failed but AI spotted a brand name in the query
    // (e.g. "sania maskatiya bridals" where fuzzy score didn't cross 10k threshold).
    //
    // GUARD: only trust the hint if at least one hint token actually appears in
    // (or is phonetically close to) the user's raw query.  Without this check,
    // the Llama model hallucinated brand names for generic queries like
    // "shadi function dress" → brandHint:"amna arshad" which had zero query overlap.
    // =========================
    if (!detectedVendor && aiExpansion?.brandHint) {
      const hint = aiExpansion.brandHint;
      const hintTokens = hint.split(" ").filter(t => t.length >= 3);
      const queryTokens = normalizedQuery
        .split(" ")
        .filter(t => t.length >= 3 && !NON_VENDOR_KEYWORDS.has(t));

      // At least one hint token must appear in or closely match a query token
      const hintInQuery = hintTokens.some(ht =>
        queryTokens.some(qt =>
          qt.includes(ht) ||
          ht.includes(qt) ||
          (qt[0] === ht[0] && stringSimilarity.compareTwoStrings(qt, ht) > 0.72)
        )
      );

      if (hintInQuery) {
        const hintMatch = uniqueVendors
          .map(v => ({
            vendor: v,
            sim: stringSimilarity.compareTwoStrings(v.toLowerCase(), hint)
          }))
          .filter(m => m.sim > 0.80 || (m.vendor.toLowerCase().includes(hint) && hint.length >= 5))
          .sort((a, b) => b.sim - a.sim)[0];
        if (hintMatch) {
          detectedVendor = hintMatch.vendor;
        }
      }
    }

    // =========================
    // 🔥 CLEAN AI CORRECTED TERM
    // When vendor is detected, the AI may have mangled the vendor name in its corrected
    // output (e.g. "hussain rehar" → "hussain rehars"). Strip the vendor tokens from
    // the corrected term so only the non-vendor keywords survive in allSearchTerms.
    // =========================
    if (detectedVendor && aiExpansion?.corrected && aiExpansion.corrected !== originalQuery) {
      const vendorTks = detectedVendor.toLowerCase().split(" ");
      const correctedNonVendor = aiExpansion.corrected
        .split(" ")
        .filter(t => !vendorTks.some(vt => stringSimilarity.compareTwoStrings(t, vt) > 0.70))
        .join(" ")
        .trim();
      // Swap the full corrupted corrected term with just the clean keyword remainder
      allSearchTerms = allSearchTerms.filter(t => t !== aiExpansion.corrected);
      if (correctedNonVendor) allSearchTerms.push(correctedNonVendor);
      allSearchTerms = [...new Set(allSearchTerms)];
    }

    // =========================
    // 🔥 REMAINING QUERY
    // =========================

    let remainingQuery = normalizedQuery;

    if (detectedVendor) {

      const vendorTokens =
        detectedVendor
          .toLowerCase()
          .split(" ");

      const queryTokens =
        normalizedQuery
          .split(" ");

      remainingQuery =
        queryTokens
          .filter(qt => {

            return !vendorTokens.some(vt =>

              stringSimilarity.compareTwoStrings(
                qt,
                vt
              ) > 0.75

            );

          })
          .join(" ")
          .trim();

    }

    const onlyVendorFilterRequested = Boolean(requestedVendorFilter) &&
      !requestedMinPrice &&
      !requestedMaxPrice &&
      !requestedColorFilter &&
      !requestedTagFilter &&
      !requestedCollectionFilter &&
      !requestedSizeFilter &&
      !requestedProductTypeFilter &&
      !requestedAvailabilityFilter;

    const pureVendorFastPath =
      detectedVendor &&
      !remainingQuery &&
      (!hasRequestedFilters || onlyVendorFilterRequested);

    if (pureVendorFastPath) {
      const fastSelectFields = `
        productId title handle vendor image price stock productType
        shopifyCreatedAt shopifyPublishedAt publishedAt firstPublishedAt
        collections tags colors sizes status
      `;
      const fastFetchLimit = Math.min(pageOffset + pageLimit + 1, 240);

      const fastProductsRaw = await Product.find({
        store: cleanStore,
        status: "ACTIVE",
        vendor: detectedVendor
      })
        .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .limit(fastFetchLimit)
        .lean()
        .select(fastSelectFields);

      const fastHasNextPage = fastProductsRaw.length > pageOffset + pageLimit;
      const fastProducts = fastProductsRaw.slice(0, pageOffset + pageLimit);
      const fastReturnedWindow = Math.max(Math.min(fastProductsRaw.length - pageOffset, pageLimit), 0);
      const totalVendorProducts = pageOffset + fastReturnedWindow + (fastHasNextPage ? 1 : 0);

      const fastCollectionIds = [
        ...new Set(
          fastProducts
            .flatMap(p => Array.isArray(p.collections) ? p.collections.map(id => String(id)) : [])
            .flatMap(id => {
              const plain = normalizeId(id);
              return [plain, `gid://shopify/Collection/${plain}`].filter(Boolean);
            })
        )
      ];

      const fastCollections = fastCollectionIds.length
        ? await Collection.find({
          store: cleanStore,
          collectionId: { $in: fastCollectionIds }
        })
          .sort({ shopifyPublishedAt: -1, firstPublishedAt: -1, shopifyCreatedAt: -1 })
          .limit(40)
          .lean()
        : [];

      const formattedFastCollections = fastCollections
        .filter(c => c.title && !isGarbageCollection(c.title))
        .filter(c => normalizedQuery.includes("rts") || !/\brts\b/i.test(c.title || ""))
        .sort((a, b) => latestCollectionTime(b) - latestCollectionTime(a))
        .slice(0, 10)
        .map(c => ({
          title: c.title || "",
          handle: c.handle || "",
          image: c.image || "",
          type: "collection",
          score: recencyScore(latestCollectionTime(c), {
            day1: 100000,
            day3: 75000,
            day7: 50000,
            day30: 25000,
            day90: 8000,
            day180: 2000
          }),
          latestDate: latestCollectionTime(c) ? new Date(latestCollectionTime(c)) : null
        }));

      const fastProductsWithMeta = fastProducts.map(p => {
        const productTime = latestProductTime(p);
        return {
          ...p,
          latestTime: productTime,
          latestDate: productTime ? new Date(productTime) : null,
          score: recencyScore(productTime, {
            day1: 55000,
            day3: 42000,
            day7: 30000,
            day30: 15000,
            day90: 5000,
            day180: 1000
          })
        };
      });

      const fastPayload = {
        query: q,
        meta: {
          originalQuery,
          finalQuery,
          fastVendorPath: true,
          detectedVendor,
          remainingQuery,
          totalProducts: totalVendorProducts,
          appliedFilters: {
            vendor: normalizeParamList(requestedVendorFilter),
            color: [],
            size: [],
            collection: [],
            productType: [],
            availability: [],
            minPrice: null,
            maxPrice: null,
            tag: []
          },
          availableCategories: {
            formals: false,
            casuals: false,
            luxuryPret: false,
            coordSet: false,
            luxury: false
          }
        },
        vendors: [
          {
            title: detectedVendor,
            type: "vendor",
            score: 999999,
            latestDate: fastProductsWithMeta[0]?.latestDate || new Date()
          }
        ],
        collections: formattedFastCollections,
        products: fastProductsWithMeta,
        suggestions: []
      };

      searchCache[cacheKey] = { data: fastPayload, timestamp: Date.now() };
      const responsePayload = paginatePayload(fastPayload);
      responsePayload.products = (responsePayload.products || []).slice(0, pageLimit);
      responsePayload.meta = {
        ...(responsePayload.meta || {}),
        returnedProducts: responsePayload.products.length,
        enforcedLimit: pageLimit
      };
      if (responsePayload.meta.pagination) {
        responsePayload.meta.pagination.totalProducts = totalVendorProducts;
        responsePayload.meta.pagination.totalPages = fastHasNextPage ? currentPage + 1 : currentPage;
        responsePayload.meta.pagination.hasNextPage = fastHasNextPage;
        responsePayload.meta.pagination.nextPage = fastHasNextPage ? currentPage + 1 : null;
        responsePayload.meta.pagination.returnedProducts = responsePayload.products.length;
      }
      return res.json(responsePayload);
    }

    // Code For Tags typo Tolerance
    let correctedRemainingQuery = remainingQuery;

    if (
      aiExpansion?.corrected &&
      detectedVendor
    ) {

      const vendorTokens =
        detectedVendor
          .toLowerCase()
          .split(" ");

      correctedRemainingQuery =
        aiExpansion.corrected
          .split(" ")
          .filter(
            t =>
              !vendorTokens.some(
                vt =>
                  stringSimilarity.compareTwoStrings(
                    t,
                    vt
                  ) > 0.75
              )
          )
          .join(" ")
          .trim();

    }

    // =========================
    // 🔥 TOKENS
    // =========================

    // Strip price-related noise words so "under 200k" doesn't pollute token scoring
    const PRICE_NOISE = new Set(["under", "below", "above", "over", "than", "mein", "tak", "se", "kam", "zyada", "budget"]);

    // Remaining tokens are used for category/tag matching and scoring — they should be clean of vendor words and price noise.
    correctedRemainingQuery =
      correctedRemainingQuery

        .replace(/\bco[\s-]?ords?\b/gi, "co-ord set")
        .replace(/\bcoords?\b/gi, "co-ord set")
        .replace(/\bco[\s-]?ord\b/gi, "co-ord set")
        .replace(/\bcoord\b/gi, "co-ord set");

    const remainingTokens =
      correctedRemainingQuery
        .split(" ")
        .filter(Boolean)
        .map(t => t.toLowerCase())
        .filter(
          t =>
            !PRICE_NOISE.has(t) &&
            !/^\d+[kK]?$/.test(t)
        );


    const CATEGORY_ALIASES = {
      formals: ["formal", "formals", "formal wear", "semi formal"],
      formal: ["formal", "formals", "formal wear", "semi formal"],   // ← ADD

      casuals: ["casual", "casuals", "daily wear", "everyday"],
      casual: ["casual", "casuals", "daily wear", "everyday"],       // ← ADD

      luxury: ["luxury", "luxury pret", "premium"],

      "co-ord set": [
        "co-ord set",
        "co ord set",
        "coord set",
        "co-ord",
        "co ord",
        "coord",
        "co-ords",
        "co ords",
        "coords"
      ],  // ← ADD
      "co-ord": ["co ord", "co-ord", "coord", "co ord set", "co-ord set", "coord set"],

      "luxury pret": ["luxury pret", "luxury", "premium pret"],       // ← ADD

      pret: ["pret", "ready to wear", "ready-to-wear"],
      festive: ["festive", "eid", "party wear", "celebration"],
    };

    // =========================
    // 🏷️ CATEGORY TAG RESOLVER
    // "formals" → ["formal", "formals", "formal wear", "semi formal"]
    // "luxury" + productType "unstitched" → ["luxury", "unstitched"]
    // =========================
    function expandCategoryToTags(tokens) {
      const expanded = new Set();
      tokens.forEach(t => {
        const aliases = CATEGORY_ALIASES[t] || CATEGORY_ALIASES[t.replace(/s$/, "")] || [];
        if (aliases.length) {
          aliases.forEach(a => expanded.add(a));
        } else {
          expanded.add(t); // original token bhi rakho
        }
      });
      return [...expanded];
    }

    const categoryTagTerms = expandCategoryToTags(remainingTokens);
    const hasCategorySearch = categoryTagTerms.length > 0 && detectedVendor;
    // Original token matching (category search ke saath bhi chahiye)

    // =========================
    // 🔥 SMART SEARCH CONDITIONS
    // =========================

    // Use MongoDB $text (inverted index) when all field flags are at defaults.
    // $text is orders of magnitude faster than $regex on large collections.
    // Falls back to $regex only when admin has toggled per-field flags or enabled description search
    // (description is not in the text index).
    const canUseTextSearch =
      searchOpts.searchInTitle !== false &&
      searchOpts.searchInVendor !== false &&
      searchOpts.searchInTags !== false &&
      searchOpts.searchInCollections !== false &&
      searchOpts.searchInDescription !== true;

    // buildOrConds: fallback used only when canUseTextSearch is false
    const buildOrConds = (terms) => {
      const conds = [];
      for (const term of terms) {
        if (!term) continue;
        const esc = escapeRegex(term);
        if (searchOpts.searchInTitle !== false)
          conds.push({ title: { $regex: esc, $options: "i" } });
        if (searchOpts.searchInVendor !== false)
          conds.push({ vendor: { $regex: esc, $options: "i" } });
        conds.push({ productType: { $regex: esc, $options: "i" } });
        if (searchOpts.searchInTags !== false) {
          conds.push({ tags: { $regex: esc, $options: "i" } });
          conds.push({ searchableText: { $regex: esc, $options: "i" } });
        }
        if (searchOpts.searchInCollections !== false)
          conds.push({ collections: { $regex: esc, $options: "i" } });
        if (searchOpts.searchInDescription === true)
          conds.push({ description: { $regex: esc, $options: "i" } });
      }
      return conds;
    };

    // Strip price noise (under/above/20k/5000) from search terms before $text / regex
    // e.g. "dress under 20k" → "dress"  |  "kurti above 3000" → "kurti"
    const stripPriceNoise = (term) =>
      (term || "").split(/\s+/)
        .filter(w => !PRICE_NOISE.has(w) && !/^\d+[kK]?$/.test(w))
        .join(" ")
        .trim();

    const cleanSearchTerms = [...new Set(
      allSearchTerms.map(stripPriceNoise).filter(Boolean)
    )];

    // Core terms for DB query: original query + synonyms + explicit colors.
    // AI related terms are intentionally excluded — they go into scoring only, not fetching
    // Using them in $text would broaden the result set and return irrelevant products
    // Occasion → DB fetch synonyms so bridal/wedding products are included in initial pool
    const explicitOccasionDbTerms = [...new Set(localOccasions.flatMap(o => OCCASION_DB_SYNONYMS[o] || []))];
    const coreDbTerms = [...new Set([
      stripPriceNoise(originalQuery),
      ...synonymWords.map(stripPriceNoise),
      aiExpansion?.corrected ? stripPriceNoise(aiExpansion.corrected) : null,
      ...explicitOccasionDbTerms,
      ...dbColorTerms
    ].filter(Boolean))];

    const productQuery = { store: cleanStore, status: "ACTIVE" };

    // =========================
    // 🔽 USER FILTER PARAMS + ADMIN SETTINGS
    // Applied on top of text/AI search — narrows results
    // =========================
    if (hideOutOfStock) {
      productQuery.stock = { $gt: 0 };
    }
    if (requestedAvailabilityFilter && isFilterActive("availability")) {
      const availabilityValues = normalizeParamList(requestedAvailabilityFilter).map(v => v.toLowerCase());
      const wantsInStock = availabilityValues.some(v =>
        v === "1" || v === "true" || v === "available" || v === "in_stock" || v === "in-stock" || v === "in stock"
      );
      const wantsOutOfStock = availabilityValues.some(v =>
        v === "0" || v === "false" || v === "unavailable" || v === "out_of_stock" || v === "out-of-stock" || v === "out of stock"
      );
      if (wantsInStock && !wantsOutOfStock) {
        productQuery.stock = { $gt: 0 };
      } else if (wantsOutOfStock && !wantsInStock) {
        productQuery.stock = { $lte: 0 };
      }
    }
    if (requestedVendorFilter && isFilterActive("vendor")) {
      const vendorValues = normalizeParamList(requestedVendorFilter);
      productQuery.vendor = vendorValues.length > 1
        ? { $in: vendorValues.map(v => new RegExp(`^${escapeRegex(v)}$`, "i")) }
        : { $regex: `^${escapeRegex(vendorValues[0])}$`, $options: "i" };
    }
    if ((requestedMinPrice || requestedMaxPrice) && isFilterActive("price")) {
      productQuery.price = {};
      if (requestedMinPrice) productQuery.price.$gte = Number(requestedMinPrice);
      if (requestedMaxPrice) productQuery.price.$lte = Number(requestedMaxPrice);
    }
    if (requestedColorFilter && isFilterActive("color")) {
      productQuery.colors = { $in: expandColorTermsForDb(normalizeColorParamValues(requestedColorFilter)) };
    }
    if (requestedTagFilter && isFilterActive("tag")) {
      productQuery.tags = { $in: normalizeParamList(requestedTagFilter).map(v => new RegExp(`^${escapeRegex(v)}$`, "i")) };
    }
    const selectedCollections = normalizeParamList(requestedCollectionFilter);
    if (selectedCollections.length && isFilterActive("collection")) {
      const collectionValues = new Set(selectedCollections.flatMap(id => {
        const cleanId = normalizeId(id);
        return [String(id), cleanId, cleanId ? `gid://shopify/Collection/${cleanId}` : ""].filter(Boolean);
      }));
      const collectionRegexes = selectedCollections.map(v => new RegExp(`^${escapeRegex(v)}$`, "i"));
      const matchedCollections = await Collection.find({
        store: cleanStore,
        $or: [
          { collectionId: { $in: [...collectionValues] } },
          { handle: { $in: collectionRegexes } },
          { title: { $in: collectionRegexes } }
        ]
      }).select("collectionId handle title").lean();
      matchedCollections.forEach(c => {
        const cleanId = normalizeId(c.collectionId);
        if (c.collectionId) collectionValues.add(String(c.collectionId));
        if (cleanId) {
          collectionValues.add(cleanId);
          collectionValues.add(`gid://shopify/Collection/${cleanId}`);
        }
      });
      productQuery.collections = { $in: [...collectionValues] };
    }
    const selectedSizes = normalizeParamList(requestedSizeFilter);
    if (selectedSizes.length && isFilterActive("size")) {
      productQuery.sizes = { $in: selectedSizes.map(v => new RegExp(`^${escapeRegex(v)}$`, "i")) };
    }
    const selectedProductTypes = normalizeParamList(requestedProductTypeFilter);
    if (selectedProductTypes.length && isFilterActive("productType")) {
      productQuery.productType = selectedProductTypes.length > 1
        ? { $in: selectedProductTypes.map(v => new RegExp(`^${escapeRegex(v)}$`, "i")) }
        : { $regex: `^${escapeRegex(selectedProductTypes[0])}$`, $options: "i" };
    }

    if (detectedVendor) {
      if (!requestedVendorFilter || normalizeParamList(requestedVendorFilter).length === 1) {
        // detectedVendor is the canonical value returned by Product.distinct().
        productQuery.vendor = detectedVendor;
      }

      if (remainingQuery) {
        // Category tag terms expand karo (formals → ["formal","formals","formal wear"...])
        const expandedTagTerms = expandCategoryToTags(remainingTokens);
        const categoryRegex =
          expandedTagTerms.length
            ? expandedTagTerms.join("|")
            : null;


        const orConds = [];

        // Title match
        remainingTokens.forEach(t => {
          orConds.push({ title: { $regex: escapeRegex(t), $options: "i" } });
        });

        // Tags match — expanded aliases se
        if (categoryRegex) {

          orConds.push({
            tags: {
              $regex: categoryRegex,
              $options: "i"
            }
          });

          orConds.push({
            searchableText: {
              $regex: categoryRegex,
              $options: "i"
            }
          });

        }

        // Collections match
        expandedTagTerms.forEach(term => {
          orConds.push({ collections: { $regex: escapeRegex(term), $options: "i" } });
        });

        if (orConds.length) productQuery.$or = orConds;
      }
    } else if (canUseTextSearch && coreDbTerms.length && !colorOnlySearch) {
      productQuery.$text = { $search: coreDbTerms.slice(0, 4).join(" ") };
    } else {
      // Admin has custom field flags — per-field regex fallback (core terms only)
      const orConds = colorOnlySearch ? [] : buildOrConds(coreDbTerms);
      if (orConds.length) productQuery.$and = [{ $or: orConds }];
    }

    // =========================
    // 🔥 SEARCH PRODUCTS
    // =========================

    if (dbColorTerms.length) {
      const colorTerms = [...new Set(dbColorTerms.map(c => String(c || "").toLowerCase().trim()).filter(Boolean))];
      if (colorTerms.length) {
        productQuery.colors = productQuery.colors || { $in: colorTerms };
      }
    }

    const userNarrowingQuery = {};
    ["stock", "vendor", "price", "colors", "tags", "collections", "sizes", "productType"].forEach(key => {
      if (productQuery[key] !== undefined) userNarrowingQuery[key] = productQuery[key];
    });

    const __dbStart = Date.now();
    const productFetchLimit = Math.min(pageOffset + (pageLimit * 3), 240);

    const selectFields = `
      productId title handle vendor image price stock productType
shopifyCreatedAt shopifyPublishedAt publishedAt firstPublishedAt
collections searchableText tags colors sizes status
      ${searchOpts.searchInDescription ? 'description' : ''}
    `;

    let products;
    try {
      products = await Product.find(productQuery)
        .sort(productQuery.$text
          ? { firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 }
          : { firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .limit(productFetchLimit)
        .maxTimeMS(15000)
        .lean()
        .select(selectFields);
    } catch (dbErr) {
      // Text index not ready (being built) — fall back to regex search
      console.warn("[Search] $text failed, falling back to regex:", dbErr.message);
      const fallbackQuery = { store: cleanStore, status: "ACTIVE", ...userNarrowingQuery };
      if (detectedVendor) fallbackQuery.vendor = productQuery.vendor;
      const regexOrConds = buildOrConds(coreDbTerms.slice(0, 3));
      if (regexOrConds.length) fallbackQuery.$or = regexOrConds;
      products = await Product.find(fallbackQuery)
        .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .limit(productFetchLimit)
        .lean()
        .select(selectFields);
    }

    searchDebug(
      "DB find ms:", Date.now() - __dbStart,
      "| pre-find ms:", __dbStart - __reqStart
    );

    // =========================
    // FALLBACK TYPO SEARCH
    // =========================

    if (currentPage === 1 && products.length < 50 && detectedVendor && !hasRequestedFilters) {
      const fallbackQuery = {
        store: cleanStore,
        status: "ACTIVE",
        ...userNarrowingQuery,
        vendor: detectedVendor
      };

      // Agar category search hai toh fallback mein bhi category filter lagao
      if (remainingQuery && categoryTagTerms.length) {
        const fallbackOrConds = [];
        categoryTagTerms.forEach(term => {
          fallbackOrConds.push({ tags: { $regex: escapeRegex(term), $options: "i" } });
          fallbackOrConds.push({ searchableText: { $regex: escapeRegex(term), $options: "i" } });
          fallbackOrConds.push({ title: { $regex: escapeRegex(term), $options: "i" } });
        });
        if (fallbackOrConds.length) fallbackQuery.$or = fallbackOrConds;
      }

      const fallbackProducts = await Product.find(fallbackQuery)
        .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .limit(150)
        .lean();

      const existingIds = new Set(products.map(p => String(p._id)));
      fallbackProducts.forEach(p => {
        if (!existingIds.has(String(p._id))) products.push(p);
      });
    }

    // =========================
    // 🔥 FUZZY KEYWORD FALLBACK
    // typo tolerance for keywords (e.g. "emrodry" → embroidery)
    // sirf keyword search pe (jab koi brand detect na hua ho)
    // =========================
    const typoEnabled = searchSettings.typoEnabled !== false;
    const typoLevel = searchSettings.typoTolerance || "medium";
    // typoEnabled=false → threshold > 1 so fuzzy never triggers
    const FUZZY_THRESHOLD = !typoEnabled ? 2 : typoLevel === "low" ? 0.7 : typoLevel === "high" ? 0.35 : 0.5;

    if (
      currentPage === 1 &&
      !hasRequestedFilters &&
      !detectedVendor &&
      products.length < 20 &&
      normalizedQuery.length >= 4
    ) {

      // Include synonym tokens in fuzzy matching
      // Require length >= 4 so short words like "for", "and", "the" don't cause
      // ht.includes("for") to match any product title containing "formal", "effort" etc.
      const FUZZY_STOP_WORDS = new Set(["for", "and", "the", "with", "that", "this", "from", "are", "was", "had", "has", "not", "but", "can", "may"]);
      const qTokens = [...new Set(
        allSearchTerms
          .flatMap(t => t.split(" "))
          .filter(t => t.length >= 4 && !FUZZY_STOP_WORDS.has(t) && !PRICE_NOISE.has(t))
      )];

      if (qTokens.length) {

        const pool = await Product.find({
          store: cleanStore,
          status: "ACTIVE"
        })
          .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
          .limit(120)
          .lean()
          // description excluded — it can be thousands of words (caused 57s hang).
          // tags included — they're short words (e.g. "embroidery") that enable typo matching.
          .select(`
            title vendor productType tags handle image price
            createdAt shopifyCreatedAt shopifyPublishedAt publishedAt firstPublishedAt status
          `);

        const existingIds = new Set(products.map(p => String(p._id)));
        let fuzzyAdded = 0;

        pool.forEach(p => {
          if (fuzzyAdded >= 50) return;
          if (existingIds.has(String(p._id))) return;

          // tags give typo coverage (e.g. "embrodry" → tag "embroidery" = 0.625 similarity)
          // Limit to 25 tags so total tokens stay ~50-80 per product, not 500+
          const tagStr = (p.tags || []).slice(0, 25).join(" ");
          const haystack = `${p.title || ""} ${p.vendor || ""} ${tagStr}`.toLowerCase();
          const hTokens = haystack.split(/[\s\-|_/,.]+/).filter(Boolean).slice(0, 120);

          let isMatch = false;
          for (const qt of qTokens) {
            for (const ht of hTokens) {
              if (
                (qt.length >= 5 && ht.includes(qt)) ||
                (
                  Math.abs(qt.length - ht.length) <= 3 &&
                  stringSimilarity.compareTwoStrings(qt, ht) >= FUZZY_THRESHOLD
                )
              ) {
                isMatch = true;
                break;
              }
            }
            if (isMatch) break;
          }

          if (isMatch) { products.push(p); fuzzyAdded++; }
        });
      }
    }

    // =========================
    // 🎀 OCCASION FALLBACK
    // Pakistani fashion products rarely have "wedding dress" in title.
    // When occasion detected but few results, fetch products by occasion tags/collections.
    // =========================
    // =========================
    // 💰 PRICE FILTER
    // Local regex parse = primary (works even if Groq times out or returns null)
    // AI maxPrice = backup / confirmation
    // =========================
    const effectiveMaxPrice = localMaxPrice || aiExpansion?.maxPrice || null;
    const effectiveMinPrice = localMinPrice || aiExpansion?.minPrice || null;

    if (effectiveMaxPrice) {
      products = products.filter(p => {
        const price = parseFloat(p.price) || 0;
        return price === 0 || price <= effectiveMaxPrice;
      });
    }

    if (effectiveMinPrice) {
      products = products.filter(p => {
        const price = parseFloat(p.price) || 0;
        return price === 0 || price >= effectiveMinPrice;
      });
    }

    // =========================
    // 🎨 HARD COLOR FILTER
    // Only applied when enough products have structured color data.
    // Products with no colors array are kept (fallback to text matching).
    // =========================
    // Skip color filter if AI says don't apply (e.g. color was hallucinated, not in query)
    const applyColorFilter = dbColorTerms.length;
    if (applyColorFilter) {
      const productsWithColorData = products.filter(p => Array.isArray(p.colors) && p.colors.length > 0);
      const colorDataRatio = productsWithColorData.length / Math.max(products.length, 1);

      // Apply hard filter only if >= 40% of products have structured color data
      if (colorDataRatio >= 0.4) {
        const colorFiltered = products.filter(p => {
          const pColors = (p.colors || []).map(c => c.toLowerCase());
          if (!pColors.length) return false;
          return dbColorTerms.some(qc =>
            pColors.some(pc => pc === qc)
          );
        });
        products = colorFiltered;
      }
    }

    if (dbColorTerms.length) {
      const strictColorFiltered = products.filter(p => {
        const pColors = (p.colors || []).map(c => String(c || "").toLowerCase());
        if (!pColors.length) return false;
        return dbColorTerms.some(qc => {
          const color = String(qc || "").toLowerCase();
          return pColors.some(pc => pc === color);
        });
      });
      products = strictColorFiltered;
    }

    // =========================
    // 🔥 FORMAT + SCORE PRODUCTS
    // =========================
    const productMatchesVendor = (product, vendorName) => {
      if (!vendorName) return true;
      const productVendor = normalizeVendorName(product.vendor);
      const targetVendor = normalizeVendorName(vendorName);
      return productVendor === targetVendor ||
        productVendor.includes(targetVendor) ||
        targetVendor.includes(productVendor);
    };

    const productSearchText = (product) => `
      ${product.title || ""}
      ${product.vendor || ""}
      ${product.productType || ""}
      ${Array.isArray(product.tags) ? product.tags.join(" ") : product.tags || ""}
      ${Array.isArray(product.collections) ? product.collections.join(" ") : product.collections || ""}
      ${Array.isArray(product.colors) ? product.colors.join(" ") : product.colors || ""}
      ${product.searchableText || ""}
    `.toLowerCase();

    const productMatchesAnyTerm = (product, terms) => {
      const cleanTerms = [...new Set((terms || [])
        .map(t => String(t || "").toLowerCase().trim())
        .filter(Boolean))];
      if (!cleanTerms.length) return true;
      const text = productSearchText(product);
      return cleanTerms.some(term =>
        text.includes(term) ||
        fuzzyFieldMatch(term, text)
      );
    };

    const productKey = (product) =>
      String(
        product.productId ||
        product.id ||
        product.handle ||
        `${product.vendor || ""}|${product.title || ""}`
      ).toLowerCase();

    const isRtsProduct = (product) =>
      /\brts\b/i.test(`${product.title || ""} ${Array.isArray(product.tags) ? product.tags.join(" ") : product.tags || ""}`);

    const dedupeProducts = (items) => {
      const byKey = new Map();
      (items || []).forEach(item => {
        const key = productKey(item);
        if (!key) return;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, item);
          return;
        }
        const existingTime = latestProductTime(existing);
        const itemTime = latestProductTime(item);
        if (
          (item.collectionPriority && !existing.collectionPriority) ||
          (itemTime > existingTime) ||
          ((item.score || 0) > (existing.score || 0) && itemTime === existingTime)
        ) {
          byKey.set(key, item);
        }
      });
      return [...byKey.values()];
    };

    if (detectedVendor) {
      products = products.filter(p => productMatchesVendor(p, detectedVendor));
    }

    if (detectedVendor && remainingTokens.length) {
      const strictTagStopWords = new Set([
        "latest", "new", "arrival", "arrivals", "collection", "collections",
        "product", "products", "dress", "dresses", "suit", "suits", "wear",
        "show", "showing", "all", "best", "top"
      ]);
      const strictTagTerms = [
        ...remainingTokens,
        ...categoryTagTerms
      ].filter(t => !strictTagStopWords.has(String(t || "").toLowerCase().trim()));
      if (strictTagTerms.length) {
        products = products.filter(p => productMatchesAnyTerm(p, strictTagTerms));
      }
    }

    function fuzzyFieldMatch(queryToken, text) {
      const words = (text || "")
        .toLowerCase()
        .split(/[\s,|/_-]+/)
        .filter(Boolean);

      return words.some(word => {
        if (word.includes(queryToken)) return true;

        const sim =
          stringSimilarity.compareTwoStrings(
            queryToken,
            word
          );

        return sim >= 0.72;
      });
    }
    // =========================
    // 🔥 COLLECTION FETCH (launched now, runs during scoring below)
    // Vendor search → $text on Collection (uses text index, skips broken $in ID lookup)
    // Keyword search → $in with collection IDs from product records
    // await happens AFTER scoring — collection query is already in-flight
    // =========================

    const activeProductCollectionIds = [
      ...new Set(
        products
          .flatMap(p => Array.isArray(p.collections) ? p.collections.map(id => String(id)) : [])
          .flatMap(id => {
            const plain = normalizeId(id);
            return [plain, `gid://shopify/Collection/${plain}`];
          })
      )
    ];
    const rawCollectionIds = (!includeCollections || detectedVendor || colorOnlySearch) ? [] : activeProductCollectionIds;

    const collectionFetchPromise = detectedVendor
      ? Promise.all([
        activeProductCollectionIds.length
          ? Collection.find({ store: cleanStore, collectionId: { $in: activeProductCollectionIds } })
            .sort({ shopifyPublishedAt: -1, firstPublishedAt: -1, shopifyCreatedAt: -1 })
            .limit(80)
            .lean()
          : Promise.resolve([]),
        Collection.find({ store: cleanStore, $text: { $search: detectedVendor } })
          .sort({ shopifyPublishedAt: -1, firstPublishedAt: -1, shopifyCreatedAt: -1 })
          .limit(20)
          .lean()
      ]).then(([activeCollections, textCollections]) => {
        const byId = new Map();
        [...activeCollections, ...textCollections].forEach(c => {
          const key = normalizeId(c.collectionId) || `${c.title || ""}|${c.handle || ""}`;
          if (!key || byId.has(key)) return;
          byId.set(key, c);
        });
        return [...byId.values()];
      })
      : !includeCollections
      ? Promise.resolve([])
      : colorOnlySearch
      ? Promise.resolve([])
      : rawCollectionIds.length
        ? Collection.find({ store: cleanStore, collectionId: { $in: rawCollectionIds } })
          .sort({ shopifyPublishedAt: -1, firstPublishedAt: -1, shopifyCreatedAt: -1 })
          .limit(50)
          .lean()
        : Promise.resolve([]);

    // Pure vendor search: entire query matched a vendor, no remaining keyword.
    // In this case title-based query scoring is irrelevant — every product belongs to
    // this vendor already. Rank purely by recency + vendor match, not by whether the
    // product title repeats the vendor name (that would unfairly penalise new products
    // whose titles use only the collection name).
    const isPureVendorSearch = !!(detectedVendor && !remainingQuery);
    const isVendorOnlySearch =
      detectedVendor &&
      (!remainingQuery || !remainingQuery.trim());

    products = products.map(p => {

      let score = 0;

      const title =
        (p.title || "")
          .toLowerCase();

      // ======================
      // TITLE TYPO TOLERANCE
      // Skip for pure vendor search — query IS the vendor name, not a product keyword
      // ======================

      if (!isPureVendorSearch) {

        const queryTokens =
          normalizedQuery.split(" ");

        const titleTokens =
          title.split(/[\s\-|_/]+/);

        queryTokens.forEach(qt => {

          titleTokens.forEach(tt => {

            const sim =
              stringSimilarity.compareTwoStrings(
                qt,
                tt
              );

            if (sim > 0.65) {
              score += sim * 15000;
            }

          });

        });

        // FULL TITLE SIMILARITY
        const fullTitleSimilarity =
          stringSimilarity.compareTwoStrings(
            normalizedQuery,
            title
          );

        if (fullTitleSimilarity > 0.4) {
          score += fullTitleSimilarity * 50000;
        }

      }

      const vendor =
        (p.vendor || "")
          .toLowerCase();

      const searchable =
        (
          p.searchableText || ""
        ).toLowerCase();

      const collections =

        Array.isArray(
          p.collections
        )

          ? p.collections
            .join(" ")
            .toLowerCase()

          : (
            p.collections || ""
          )
            .toString()
            .toLowerCase();

      const tags =

        Array.isArray(
          p.tags
        )

          ? p.tags
            .join(" ")
            .toLowerCase()

          : (
            p.tags || ""
          )
            .toString()
            .toLowerCase();

      const productType =
        (p.productType || "")
          .toLowerCase();

      const combinedSearchText = `
  ${title}
  ${searchable}
  ${collections}
  ${tags}
  ${productType}
`.toLowerCase();
      // ======================
      // EXACT QUERY
      // ======================

      // Exact/contains query match — skip for pure vendor search
      if (!isPureVendorSearch) {

        if (title === normalizedQuery) {
          score += 100000;
        }

        // ======================
        // TITLE CONTAINS QUERY
        // ======================
        if (title.includes(normalizedQuery)) {
          score += 15000;
        }

      }

      // ======================
      // VENDOR MATCH
      // ======================

      if (
        detectedVendor &&
        vendor.includes(detectedVendor.toLowerCase())
      ) {
        score += 25000;
      }

      // TITLE HAS VENDOR — only boost when remainingQuery exists
      // (pure vendor search: all products are from this vendor, no extra boost needed)
      if (
        !isPureVendorSearch &&
        detectedVendor &&
        title.includes(detectedVendor.toLowerCase())
      ) {
        score += 12000;
      }

      function fuzzyFieldMatch(queryToken, text) {
        const words = (text || "")
          .toLowerCase()
          .split(/[\s,|/_-]+/)
          .filter(Boolean);

        return words.some(word => {
          if (word.includes(queryToken)) return true;

          const sim = stringSimilarity.compareTwoStrings(
            queryToken,
            word
          );

          return sim >= 0.72;
        });
      }

      // ======================
      // TOKEN MATCHING
      // ======================

      remainingTokens.forEach(token => {
        if (title.includes(token)) score += 12000;

        if (
          fuzzyFieldMatch(
            token,
            combinedSearchText
          )
        ) {
          score += 18000;
        }
      });

      // Category tag aliases bhi score karo
      if (hasCategorySearch) {
        categoryTagTerms.forEach(term => {
          if (tags.includes(term)) score += 30000;       // tag exact match — highest
          if (title.includes(term)) score += 20000;
          if (searchable.includes(term)) score += 12000;
          if (collections.includes(term)) score += 8000;
        });
      }

      // ======================
      // RECENCY BOOST 🔥
      // ======================

      const productTime =
        latestProductTime(p);

      score += recencyScore(
        productTime,
        {
          day1: 55000,
          day3: 42000,
          day7: 30000,
          day30: 15000,
          day90: 5000,
          day180: 1000
        }
      );

      // ======================
      // KEYWORD MATCH (typo tolerant) — prioritize ke liye
      // ======================
      let keywordHits = 0;
      if (remainingTokens.length) {
        const hayTokens =
          (title + " " + searchable)
            .split(/[\s\-|_/,.]+/)
            .filter(Boolean);

        remainingTokens.forEach(qt => {
          if (qt.length < 3) return;
          const hit = hayTokens.some(ht =>
            ht.includes(qt) ||
            (
              Math.abs(qt.length - ht.length) <= 3 &&
              stringSimilarity.compareTwoStrings(qt, ht) >= FUZZY_THRESHOLD
            )
          );
          if (hit) keywordHits++;
        });
      }

      // ======================
      // RTS PENALTY (pure vendor search)
      // RTS products are daily restocks — suppress them unless user searched "rts"
      // ======================
      if (
        isPureVendorSearch &&
        !normalizedQuery.includes("rts") &&
        (title.includes("(rts)") || /\brts\b/.test(title))
      ) {
        score -= 35000;
      }

      // ======================
      // SYNONYM MATCH BOOST
      // Products matching synonym terms get extra relevance signal
      // ======================
      synonymWords.forEach(syn => {
        if (title.includes(syn)) score += 8000;
        if (searchable.includes(syn)) score += 4000;
        if (tags.includes(syn)) score += 3000;
        if (collections.includes(syn)) score += 2000;
      });

      // ======================
      // 🎨 COLOR BOOST
      // Structured colors (from metafield/variant) are highest confidence.
      // Text-based color detection (title/tags/searchable) is fallback.
      // ======================
      if (effectiveColors.length) {
        const structuredColors = (p.colors || []).map(c => c.toLowerCase());
        effectiveColors.forEach(color => {
          const structuredMatch = structuredColors.some(sc =>
            sc === color || sc.includes(color) || color.includes(sc)
          );
          if (structuredMatch) {
            score += 35000; // highest — exact match from metafield/variant data
          } else if (title.includes(color)) {
            score += 18000;
          } else if (tags.includes(color)) {
            score += 10000;
          } else if (searchable.includes(color)) {
            score += 6000;
          }
        });
      }

      // ======================
      // 🎉 OCCASION BOOST
      // Scores all detected occasions (new schema returns array)
      // ======================
      if (aiExpansion?.occasions?.length || aiExpansion?.occasion) {
        const OCC_TAGS = {
          eid: ['eid', 'festive', 'pret', 'eid collection'],
          mehndi: ['mehndi', 'mehendi', 'colorful', 'festive'],
          barat: ['barat', 'bridal', 'heavy embroidery', 'baraat'],
          valima: ['valima', 'waleema', 'formal bridal'],
          nikkah: ['nikkah', 'nikah', 'formal', 'bridal'],
          wedding: ['wedding', 'shadi', 'bridal', 'barat', 'valima', 'mehndi'],
          party: ['party', 'formal', 'dinner', 'evening', 'event', 'function', 'dawat'],
          festive: ['festive', 'party', 'eid', 'celebration', 'formal'],
          casual: ['casual', 'daily', 'lawn', 'cotton', 'office', 'pret'],
          formal: ['formal', 'office', 'semi-formal', 'professional'],
          bridal: ['bridal', 'wedding', 'barat', 'dulhan', 'heavy'],
          summer: ['summer', 'lawn', 'cotton', 'light', 'printed'],
          winter: ['winter', 'khaddar', 'velvet', 'warm', 'heavy']
        };
        const allOccasions = aiExpansion.occasions?.length ? aiExpansion.occasions : (aiExpansion.occasion ? [aiExpansion.occasion] : []);
        // Higher multiplier when AI is confident — beats recency boost for occasion queries
        const occMult = (aiExpansion.confidence || 0) >= 80 ? 2.5 : 1;
        allOccasions.forEach(occ => {
          const occTerms = OCC_TAGS[occ] || [occ];
          occTerms.forEach(term => {
            if (title.includes(term)) score += Math.round(25000 * occMult);
            if (tags.includes(term)) score += Math.round(18000 * occMult);
            if (searchable.includes(term)) score += Math.round(10000 * occMult);
          });
        });
      }

      // ======================
      // 📦 PRODUCT TYPE BOOST
      // ======================
      if (aiExpansion?.productType) {
        const pt = aiExpansion.productType.toLowerCase();
        const pType = (p.productType || "").toLowerCase();

        if (
          pType.includes(pt) ||
          fuzzyFieldMatch(pt, pType)
        ) {
          score += 25000;
        }
        else if (searchable.includes(pt)) {
          score += 6000;
        }
      }

      // ======================
      // 🇵🇰 PAKISTANI PRET TERMS BOOST
      // Store-specific product vocabulary: kurta, co-ord, 3-piece, lawn suit, kaftan, tissue, pret
      // ======================
      const PRET_TERMS = ['kurta', 'co-ord', '3-piece', '3 piece', 'lawn suit', 'kaftan', 'tissue', 'pret', 'couture', 'shalwar', 'salwar', 'dupatta', 'kameez'];
      PRET_TERMS.forEach(term => {
        if (title.includes(term)) score += 4000;
        if (searchable.includes(term)) score += 2000;
      });

      // ======================
      // 🧵 FABRIC BOOST
      // ======================
      if (aiExpansion?.fabric?.length) {
        aiExpansion.fabric.forEach(f => {
          if (title.includes(f)) score += 10000;
          if (tags.includes(f)) score += 7000;
          if (searchable.includes(f)) score += 5000;
        });
      }

      // ======================
      // ✨ ATTRIBUTE BOOST
      // ======================
      if (aiExpansion?.attributes?.length) {
        aiExpansion.attributes.forEach(attr => {
          if (title.includes(attr)) score += 8000;
          if (tags.includes(attr)) score += 5000;
          if (searchable.includes(attr)) score += 3000;
        });
      }

      // ======================
      // 🎨 COLOR SYNONYM BOOST
      // ======================
      if (aiExpansion?.colorSynonyms?.length) {
        aiExpansion.colorSynonyms.forEach(syn => {
          if (title.includes(syn)) score += 5000;
          if (tags.includes(syn)) score += 3000;
          if (searchable.includes(syn)) score += 2000;
        });
      }

      // ======================
      // ❌ NEGATIVE KEYWORD PENALTY
      // ======================
      if (aiExpansion?.negativeKeywords?.length) {
        aiExpansion.negativeKeywords.forEach(neg => {
          if (title.includes(neg) || tags.includes(neg)) score -= 20000;
        });
      }

      // ======================
      // AI RELATED TERMS BOOST
      // ======================
      if (aiExpansion?.related?.length) {
        aiExpansion.related.forEach(term => {
          if (title.includes(term)) score += 18000;
          if (searchable.includes(term)) score += 9000;
          if (tags.includes(term)) score += 7000;
          if (collections.includes(term)) score += 5000;
        });
      }

      // ======================
      // OLD PRODUCT PENALTY
      // Penalize stale inventory — user almost never wants 2-year-old products at top
      // ======================
      const pDays = daysSinceTime(productTime);
      if (pDays > 730) score -= 50000;
      else if (pDays > 365) score -= 25000;

      // ======================
      // DESCRIPTION MATCH (when searchInDescription enabled)
      // ======================
      if (searchOpts.searchInDescription) {
        const desc = (p.description || "").toLowerCase();
        if (desc.includes(normalizedQuery)) score += 4000;
        synonymWords.forEach(syn => {
          if (desc.includes(syn)) score += 2000;
        });
        remainingTokens.forEach(t => {
          if (desc.includes(t)) score += 1500;
        });
      }

      return {
        ...p,
        keywordHits,
        latestTime: productTime,
        latestDate:
          productTime
            ? new Date(productTime)
            : null,
        score
      };
    });

    // brand + keyword: keep only products that match the keyword or any AI-expanded term
    // Only filter if enough products match — avoid removing most of a brand's catalog
    // when the remaining keyword is a generic word (e.g. "dress", "suit", "latest")
    if (detectedVendor && remainingTokens.length) {
      const aiTerms = (aiExpansion?.related || []);
      const matched = products.filter(p => {

        const title =
          (p.title || "").toLowerCase();

        const searchable =
          (p.searchableText || "").toLowerCase();

        const tags =
          Array.isArray(p.tags)
            ? p.tags.join(" ").toLowerCase()
            : (p.tags || "").toString().toLowerCase();

        const collections =
          Array.isArray(p.collections)
            ? p.collections.join(" ").toLowerCase()
            : (p.collections || "").toString().toLowerCase();

        const productType =
          (p.productType || "").toLowerCase();

        const combinedSearchText = `
  ${title}
  ${searchable}
  ${collections}
  ${tags}
  ${productType}
`.toLowerCase();

        let allFilterTokens = [
          ...remainingTokens,
          ...(aiExpansion?.related || []),
          ...(aiExpansion?.categories || []),
          ...(aiExpansion?.searchKeywords || [])
        ];

        allFilterTokens = [
          ...new Set(
            allFilterTokens.flatMap(t => [
              t,
              ...(CATEGORY_ALIASES[t] || []),
              ...(CATEGORY_ALIASES[t.replace(/s$/, "")] || [])  // ← YEH ADD KAREIN
            ])
          )
        ];

        // Category search match — agar user ne "formals" type kiya aur product ke tags mein "formal" hai toh match
        const categoryMatched =
          categoryTagTerms.some(term =>
            combinedSearchText.includes(
              term.toLowerCase()
            )
          );

        const matchedTokens =
          allFilterTokens.filter(token =>
            fuzzyFieldMatch(
              token,
              combinedSearchText
            )
          );

        const productScore =
          p.keywordHits || 0;

        if (hasCategorySearch) {
          return categoryMatched;
        }

        return (
          matchedTokens.length > 0 ||
          productScore > 0
        );
      });
      // Only apply filter if it keeps ≥ 20% of results or at least 8 products.
      // Below that threshold the keyword is likely too generic — let scoring do the job.
      if (
        matched.length >= 8 ||
        matched.length >= products.length * 0.20
      ) {
        products = matched;
      }
    }

    // Pure vendor search => newest products first

    // =========================
    // 🔥 FINAL PRODUCT SORT
    // =========================

    const defaultSort = searchSettings.defaultSort || "relevance";
    const sortNewestFirst = (a, b) => {
      const priorityDiff = (b.collectionPriority || 0) - (a.collectionPriority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      if (!normalizedQuery.includes("rts")) {
        const rtsDiff = Number(isRtsProduct(a)) - Number(isRtsProduct(b));
        if (rtsDiff !== 0) return rtsDiff;
      }
      const timeDiff = (b.latestTime || 0) - (a.latestTime || 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.score || 0) - (a.score || 0);
    };

    if (isPureVendorSearch) {

      products.sort(sortNewestFirst);

    } else if (defaultSort === "relevance") {
      products.sort(sortNewestFirst);
    } else if (defaultSort === "newest") {
      products.sort(sortNewestFirst);
    } else if (defaultSort === "oldest") {
      products.sort((a, b) => (a.latestTime || 0) - (b.latestTime || 0));
    } else if (defaultSort === "price_asc") {
      products.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0));
    } else if (defaultSort === "price_desc") {
      products.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
    }
    // =========================
    // 🔥 SMART VENDORS
    // =========================

    let vendorResults =

      uniqueVendors

        .filter(v => {

          const vendorName =
            v.toLowerCase();

          // FULL QUERY
          if (
            vendorName.includes(normalizedQuery)
          ) {
            return true;
          }

          // DETECTED VENDOR
          if (

            detectedVendor &&

            vendorName ===
            detectedVendor.toLowerCase()

          ) {
            return true;
          }

          // TOKEN MATCH
          return remainingTokens.some(
            token =>
              vendorName.includes(
                token
              )
          );

        })

        .map(vendor => {

          // PRODUCTS OF THIS VENDOR
          const vendorProducts =

            products.filter(p =>

              (
                p.vendor || ""
              )
                .toLowerCase()
                .includes(
                  vendor.toLowerCase()
                )

            );

          // LATEST PRODUCT
          const latestProduct =

            [...vendorProducts].sort((a, b) =>
              latestProductTime(b) -
              latestProductTime(a)

            )[0];

          const latestTime =
            latestProduct
              ? latestProductTime(latestProduct)
              : 0;

          return {

            title:
              vendor,

            type:
              "vendor",

            latestDate:
              latestProduct
                ? new Date(latestTime)
                : null,

            // Recency of latest product is PRIMARY signal.
            // Capped product-based score prevents old brands with many products from dominating.
            score:
              recencyScore(latestTime, {
                day1: 80000,
                day3: 60000,
                day7: 40000,
                day30: 20000,
                day90: 5000,
                day180: 1000
              }) +
              Math.min(
                vendorProducts.reduce(
                  (acc, p) => acc + (p.score || 0),
                  0
                ) * 0.05,
                25000
              )

          };

        });


    // =========================
    // 🔥 SORT VENDORS
    // =========================

    vendorResults.sort((a, b) => {

      // SCORE FIRST
      if (
        b.score !== a.score
      ) {

        return (
          b.score - a.score
        );
      }

      // THEN LATEST
      return (

        new Date(
          b.latestDate
        ) -

        new Date(
          a.latestDate
        )

      );

    });
    if (detectedVendor) {

      vendorResults = [

        {
          title: detectedVendor,
          type: "vendor",
          score: 999999,
          latestDate: new Date()
        },

        ...vendorResults.filter(
          v =>
            v.title.toLowerCase() !==
            detectedVendor.toLowerCase()
        )

      ];

    }

    // =========================
    // 🔥 COLLECTIONS
    // collectionFetchPromise was launched before scoring — likely already resolved
    // =========================
    const __colStart = Date.now();
    let collections = await collectionFetchPromise;
    searchDebug("Collection fetch ms:", Date.now() - __colStart, "| total so far:", Date.now() - __reqStart);

    // =========================
    // 🔥 SMART COLLECTIONS
    // =========================

    collections =

      collections.map(c => {

        // RELATED PRODUCTS
        const relatedProducts =
          products.filter(p =>
            Array.isArray(p.collections) &&
            p.collections.some(id =>
              normalizeId(id) === normalizeId(c.collectionId)   // dono side normalize
            )
          );
        // LATEST PRODUCT
        const latestProduct =
          [...relatedProducts].sort((a, b) =>
            latestProductTime(b) -
            latestProductTime(a)
          )[0];

        const topProductScore =
          relatedProducts.length
            ? Math.max(
              ...relatedProducts.map(p => p.score || 0)
            )
            : 0;

        const averageProductScore =
          relatedProducts.length
            ? relatedProducts.reduce(
              (acc, p) => acc + (p.score || 0),
              0
            ) / relatedProducts.length
            : 0;

        let collectionScore =
          Math.min(topProductScore * 0.30, 60000) +
          Math.min(averageProductScore * 0.15, 25000) +
          Math.min(relatedProducts.length * 800, 6000);

        const title = (c.title || "").toLowerCase();

        const titleVendorMatch =
          detectedVendor ? normalizeVendorName(title).includes(normalizeVendorName(detectedVendor)) : false;
        const activeVendorCollection =
          detectedVendor && relatedProducts.some(p => productMatchesVendor(p, detectedVendor));

        if (titleVendorMatch) {
          collectionScore += 60000;
        }

        if (activeVendorCollection) {
          collectionScore += 80000;
        }

        if (detectedVendor) {

          const vendorMatch =
            (c.searchableText || "")
              .toLowerCase()
              .includes(
                detectedVendor.toLowerCase()
              );

          if (vendorMatch) {
            collectionScore += 35000;
          }

        }

        // Skip query-title matching for pure vendor search — all collections
        // belong to this vendor already; title matching just gives the generic
        // brand-page collection (title = vendor name exactly) an unfair +90k head start
        if (!isPureVendorSearch) {
          if (normalizedQuery && title === normalizedQuery) {
            collectionScore += 90000;
          } else if (normalizedQuery && title.includes(normalizedQuery)) {
            collectionScore += 45000;
          }
        }

        // Pure vendor search: the generic brand-page collection whose title IS the
        // vendor name (e.g. "Jeevan By Hussain Rehar") is a catch-all aggregator —
        // push it below specific product collections (Spring Summer '26, etc.)
        if (
          isPureVendorSearch &&
          detectedVendor &&
          title === detectedVendor.toLowerCase()
        ) {
          collectionScore -= 60000;
        }

        remainingTokens.forEach(token => {
          function fuzzyFieldMatch(queryToken, text) {
            const words = (text || "")
              .toLowerCase()
              .split(/[\s,|/_-]+/)
              .filter(Boolean);

            return words.some(word => {
              if (word.includes(queryToken)) return true;

              const sim =
                stringSimilarity.compareTwoStrings(
                  queryToken,
                  word
                );

              return sim >= 0.72;
            });
          }
          if (!token) return;
          if (title.includes(token)) {
            collectionScore += 18000;
          }
          if (
            (c.searchableText || "")
              .toLowerCase()
              .includes(token)
          ) {
            collectionScore += 7000;
          }
        });

        // ======================
        // NEW COLLECTION BOOST
        // ======================

        // Collection ki APNI date (shopifyCreatedAt → fallback firstPublishedAt).
        // Product ki date yahan MIX nahi karni — warna purani collection jisme
        // ek naya product hai wo "fresh" lagne lag jati hai.
        const collectionTime =
          latestCollectionTime(c);

        // Collection ki apni recency boost
        collectionScore += recencyScore(
          collectionTime,
          {
            day1: 100000,
            day3: 75000,
            day7: 50000,
            day30: 25000,
            day90: 8000,
            day180: 2000
          }
        );

        if (c.productsCount) {
          collectionScore += Math.min(
            Number(c.productsCount || 0) * 250,
            12000
          );
        }

        // 1 saal+ purani collection demote (apni date pe, product pe nahi)
        if (
          collectionTime &&
          daysSinceTime(collectionTime) > 365
        ) {
          collectionScore -= 25000;
        }

        return {

          ...c,

          titleVendorMatch,
          activeVendorCollection,

          // latestDate / latestTime = collection ki APNI date (product se polluted nahi)
          latestDate:
            collectionTime
              ? new Date(collectionTime)
              : null,
          latestTime:
            collectionTime,
          score: collectionScore
        };

      });


    // =========================
    // 🔥 SORT COLLECTIONS
    // =========================

    // brand detect hua to sirf brand-named collections rakho
    if (detectedVendor) {
      const brandCollections = collections.filter(c => c.titleVendorMatch || c.activeVendorCollection);
      if (brandCollections.length) {
        collections = brandCollections;
      }
    }


    collections.sort((a, b) => {
      // active vendor product relation is stronger than a text-only brand match
      if (a.activeVendorCollection !== b.activeVendorCollection) {
        return a.activeVendorCollection ? -1 : 1;
      }

      // brand-named collections sabse pehle
      if (a.titleVendorMatch !== b.titleVendorMatch) {
        return a.titleVendorMatch ? -1 : 1;
      }

      // collection ki APNI date — newest collection upar
      if ((b.latestTime || 0) !== (a.latestTime || 0)) {
        return (b.latestTime || 0) - (a.latestTime || 0);
      }

      // same vintage → relevance score se tiebreak
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }

      return Number(b.productsCount || 0) - Number(a.productsCount || 0);
    });

    if (detectedVendor && collections.length) {
      const latestVendorCollection = collections.find(c =>
        c.collectionId &&
        !isGarbageCollection(c.title) &&
        normalizeVendorName(c.title) !== normalizeVendorName(detectedVendor) &&
        (normalizedQuery.includes("rts") || !/\brts\b/i.test(c.title || ""))
      );

      if (latestVendorCollection) {
        const plainCollectionId = normalizeId(latestVendorCollection.collectionId);
        const collectionIds = [
          plainCollectionId,
          String(latestVendorCollection.collectionId),
          `gid://shopify/Collection/${plainCollectionId}`
        ];

        let latestCollectionProducts = await Product.find({
          store: cleanStore,
          status: "ACTIVE",
          vendor: detectedVendor,
          collections: { $in: collectionIds }
        })
          .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
          .limit(80)
          .lean()
          .select(selectFields);

        if (remainingTokens.length) {
          const strictTagStopWords = new Set([
            "latest", "new", "arrival", "arrivals", "collection", "collections",
            "product", "products", "dress", "dresses", "suit", "suits", "wear",
            "show", "showing", "all", "best", "top"
          ]);
          const strictTagTerms = [
            ...remainingTokens,
            ...categoryTagTerms
          ].filter(t => !strictTagStopWords.has(String(t || "").toLowerCase().trim()));
          if (strictTagTerms.length) {
            latestCollectionProducts = latestCollectionProducts.filter(p =>
              productMatchesAnyTerm(p, strictTagTerms)
            );
          }
        }

        latestCollectionProducts = latestCollectionProducts
          .filter(p => normalizedQuery.includes("rts") || !isRtsProduct(p))
          .map(p => {
            const time = latestProductTime(p);
            return {
              ...p,
              collectionPriority: 1,
              latestCollectionTitle: latestVendorCollection.title || "",
              latestTime: time,
              latestDate: time ? new Date(time) : null,
              score: (p.score || 0) + 250000
            };
          });

        if (latestCollectionProducts.length) {
          products = dedupeProducts([
            ...latestCollectionProducts,
            ...products
          ]);
          products.sort(sortNewestFirst);
        }
      }
    }

    // =========================
    // HIDE RANDOM COLLECTIONS
    // =========================

    if (
      products.length === 0 &&
      !detectedVendor
    ) {
      collections = [];
    }

    // =========================
    // 🔥 FORMAT COLLECTIONS
    // =========================
    const formattedCollections =
      collections
        .filter(c => c.title)
        .filter(c => !isGarbageCollection(c.title))
        .filter(c => {
          // Hide RTS collections unless user explicitly searched for "rts"
          if (
            !normalizedQuery.includes("rts") &&
            /\brts\b/i.test(c.title)
          ) return false;
          return true;
        })
        .slice(0, 10)
        .map(c => ({

          title:
            c.title || "",

          handle:
            c.handle || "",

          image:
            c.image || "",

          type:
            "collection",

          score:
            c.score || 0,

          latestDate:
            c.latestDate || null

        }));

    products = dedupeProducts(products);
    products.sort(sortNewestFirst);

    // Category-based collection filter: if collection title contains a category term, only keep it if query also contains that category (or its synonyms)
    // Avoid showing irrelevant collections for generic queries like "summer dress" → show only collections with "summer" in title, not all dress collections
    const availableCategories = {
      formals: false,
      casuals: false,
      luxuryPret: false,
      coordSet: false,
      luxury: false
    };

    products.forEach(p => {

      const tags = Array.isArray(p.tags)
        ? p.tags.map(t => String(t).toLowerCase())
        : [];

      const productType =
        (p.productType || "").toLowerCase();

      const searchableText = `
${tags.join(" ")}
${p.searchableText || ""}
${p.title || ""}
${p.productType || ""}
`.toLowerCase();

      // Formals
      if (
        tags.some(t =>
          t.includes("formal")
        )
      ) {
        availableCategories.formals = true;
      }

      // Casuals
      if (
        tags.some(t =>
          t.includes("casual")
        )
      ) {
        availableCategories.casuals = true;
      }

      // Luxury Pret
      if (
        tags.some(t =>
          t.includes("luxury pret")
        )
      ) {
        availableCategories.luxuryPret = true;
      }

      // Co-ord Sets
      if (
        searchableText.includes("co-ord") ||
        searchableText.includes("co ord") ||
        searchableText.includes("coord")
      ) {
        availableCategories.coordSet = true;
      }

      // Luxury (only unstitched)
      if (
        productType.includes("unstitched") &&
        tags.some(t =>
          t.includes("luxury")
        )
      ) {
        availableCategories.luxury = true;
      }

    });

    // =========================
    // 🔥 FINAL RESPONSE
    // =========================
    const payload = {

      query: q,

      meta: {
        originalQuery,
        finalQuery,
        synonymsApplied: synonymWords,
        aiExpansion: aiExpansion
          ? {
            corrected: aiExpansion.corrected,
            intent: aiExpansion.intent,
            confidence: aiExpansion.confidence,
            brands: aiExpansion.brands,
            brandHint: aiExpansion.brandHint,
            colors: aiExpansion.colors,
            color: aiExpansion.color,
            colorSynonyms: aiExpansion.colorSynonyms,
            categories: aiExpansion.categories,
            subCategories: aiExpansion.subCategories,
            productType: aiExpansion.productType,
            occasions: aiExpansion.occasions,
            occasion: aiExpansion.occasion,
            fabric: aiExpansion.fabric,
            attributes: aiExpansion.attributes,
            style: aiExpansion.style,
            embellishment: aiExpansion.embellishment,
            season: aiExpansion.season,
            negativeKeywords: aiExpansion.negativeKeywords,
            searchKeywords: aiExpansion.searchKeywords,
            related: aiExpansion.related,
            searchPhrase: aiExpansion.searchPhrase,
            maxPrice: aiExpansion.maxPrice,
            minPrice: aiExpansion.minPrice,
            shouldApplyBrandFilter: aiExpansion.shouldApplyBrandFilter,
            shouldApplyColorFilter: aiExpansion.shouldApplyColorFilter,
            shouldApplyCategoryFilter: aiExpansion.shouldApplyCategoryFilter,
            shouldApplyCollectionFilter: aiExpansion.shouldApplyCollectionFilter,
          }
          : null,
        colors: effectiveColors,
        maxPrice: effectiveMaxPrice,
        minPrice: effectiveMinPrice,
        appliedFilters: {
          vendor: normalizeParamList(requestedVendorFilter),
          color: normalizeColorParamValues(requestedColorFilter),
          size: normalizeParamList(requestedSizeFilter),
          collection: normalizeParamList(requestedCollectionFilter),
          productType: normalizeParamList(requestedProductTypeFilter),
          availability: normalizeParamList(requestedAvailabilityFilter),
          minPrice: requestedMinPrice ? Number(requestedMinPrice) : null,
          maxPrice: requestedMaxPrice ? Number(requestedMaxPrice) : null,
          tag: normalizeParamList(requestedTagFilter)
        },
        detectedVendor,
        remainingQuery,
        totalProducts:
          products.length,
        availableCategories
      },
      vendors:
        vendorResults,
      collections:
        formattedCollections,
      products:
        products
          .slice(0, 500),
      suggestions: aiSettings.suggestionsEnabled !== false
        ? buildSuggestions(aiExpansion, originalQuery)
        : []
    };

    // 🔥 CACHE (60s)
    if (Object.keys(searchCache).length > SEARCH_CACHE_MAX) {
      for (const k in searchCache) {
        if (Date.now() - searchCache[k].timestamp > SEARCH_CACHE_TTL) {
          delete searchCache[k];
        }
      }
    }
    searchCache[cacheKey] = { data: payload, timestamp: Date.now() };

    searchDebug("TOTAL handler ms:", Date.now() - __reqStart);

    const responsePayload = paginatePayload(payload);
    responsePayload.products = (responsePayload.products || []).slice(0, pageLimit);
    responsePayload.meta = {
      ...(responsePayload.meta || {}),
      returnedProducts: responsePayload.products.length,
      enforcedLimit: pageLimit
    };
    if (responsePayload.meta.pagination) {
      responsePayload.meta.pagination.returnedProducts = responsePayload.products.length;
    }
    res.json(responsePayload);
  } catch (err) {

    console.error("SEARCH ERROR:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

router.get("/trending-brands", async (req, res) => {

  try {

    // =========================
    // STORE
    // =========================

    const { store, shop } = req.query;
    const rawStore = store || shop;

    if (!rawStore) {

      return res.status(400)
        .json({
          error: "Store is required"
        });

    }

    const cleanStore = normalizeDomain(rawStore);

    // =========================
    // TRENDING BRANDS CACHE
    // =========================
    const tbCacheKey = `trending-brands|${cleanStore}`;
    const tbCached = trendingCache[tbCacheKey];
    if (tbCached && Date.now() - tbCached.timestamp < TRENDING_CACHE_TTL) {
      return res.json(tbCached.data);
    }

    // =========================
    // PARALLEL PREFETCH: stores + settings + featured + analytics
    // (stores query is filtered now — was fetching ALL stores before)
    // =========================

    const [matchedStores, trendingSettingsDoc, featuredBrands, analyticsData] = await Promise.all([
      Store.find({
        domain: { $regex: new RegExp(`^(https?://)?(www\\.)?${escapeRegex(cleanStore)}/?$`, "i") }
      }).lean(),
      TrendingSettings.findOne({ store: cleanStore }).lean(),
      FeaturedBrand.find({ active: true, store: cleanStore }).lean(),
      Analytics.aggregate([
        { $match: { store: cleanStore, vendor: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: "$vendor",
            searches: { $sum: { $cond: [{ $eq: ["$type", "search"] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] } }
          }
        }
      ])
    ]);

    if (!matchedStores.length) {
      return res.status(404).json({ error: "No matching store found", cleanStore });
    }

    const pinnedBrandNames =
      new Set((trendingSettingsDoc?.pinnedBrandNames || []).map(b => b.toLowerCase()));

    const featuredMap = {};
    featuredBrands.forEach(f => {
      if (!f?.title) return;
      featuredMap[f.title.toLowerCase()] = f;
    });

    const analyticsMap = {};
    analyticsData.forEach(a => {
      if (!a?._id) return;
      analyticsMap[a._id.toLowerCase()] = a;
    });

    // =========================
    // FETCH PRODUCTS
    // =========================

    const results =
      await Promise.all(

        matchedStores.map(async storeDoc => {

          try {

            const cleanDomain =
              storeDoc.domain
                ?.replace(/^https?:\/\//, "")
                .replace(/\/$/, "");

            const response =
              await fetch(

                `https://${cleanDomain}/admin/api/2026-04/graphql.json`,

                {
                  method: "POST",

                  headers: {
                    "X-Shopify-Access-Token":
                      storeDoc.accessToken,

                    "Content-Type":
                      "application/json",
                  },

                  body: JSON.stringify({

                    query: `
{
  products(
    first: 60,
    sortKey: CREATED_AT,
    reverse: true,
    query: "status:active"
  ) {

    edges {

      node {
        id
        vendor
        title
        handle
        createdAt
        updatedAt
        publishedAt
        status

        images(first:1){
          edges{
            node{
              url
            }
          }
        }

        variants(first:1){
          edges{
            node{
              price
            }
          }
        }

      }

    }

  }
}
                    `,

                  }),
                }
              );

            const data =
              await response.json();

            if (
              data?.errors
            ) {

              console.log(
                "SHOPIFY GRAPHQL ERROR:",
                data.errors
              );

              return [];

            }

            return (

              data?.data?.products?.edges?.map(p => ({

                id:
                  p.node.id || "",

                title:
                  p.node.title || "",

                handle:
                  p.node.handle || "",

                vendor:
                  p.node.vendor || "",

                createdAt:
                  p.node.createdAt || null,

                updatedAt:
                  p.node.updatedAt || null,

                publishedAt:
                  p.node.publishedAt || null,

                status:
                  p.node.status || "",

                timestamp:
                  new Date(
                    p.node.publishedAt ||
                    p.node.createdAt ||
                    0
                  ).getTime(),

                image:
                  p.node.images
                    ?.edges?.[0]
                    ?.node?.url || "",

                price:
                  Number(
                    p.node.variants?.edges?.[0]
                      ?.node?.price || 0
                  ),

              })) || []

            );

          } catch (err) {

            console.error(
              "STORE FETCH ERROR:",
              storeDoc.domain,
              err.message
            );

            return [];

          }

        })

      );

    // =========================
    // PRODUCTS — prefer local MongoDB (always up-to-date, covers all vendors)
    // Fall back to Shopify API results only when local DB is empty
    // =========================

    // Build local product list from MongoDB first
    const localDbProducts = await Product.find({ store: cleanStore, status: 'ACTIVE' })
      .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
      .limit(400)
      .select('vendor title handle image price shopifyCreatedAt firstPublishedAt shopifyPublishedAt publishedAt productId')
      .lean();

    // Normalize local DB products to the same shape used below
    const localProductsMapped = localDbProducts.map(p => ({
      id: String(p.productId || p._id),
      title: p.title || '',
      handle: p.handle || '',
      vendor: p.vendor || '',
      status: 'ACTIVE',
      publishedAt: p.firstPublishedAt || p.shopifyPublishedAt || p.publishedAt || p.shopifyCreatedAt || null,
      createdAt: p.shopifyCreatedAt || p.firstPublishedAt || null,
      image: p.image || '',
      price: Number(p.price || 0),
      shopifyCreatedAt: p.shopifyCreatedAt || null,
      firstPublishedAt: p.firstPublishedAt || null,
    }));

    // Shopify API results (may be empty if API failed or token expired)
    const apiProducts = results
      .flat()
      .filter(p => p.status === 'ACTIVE' && p.publishedAt);

    // Use local DB products as primary; supplement with API if it returned data
    const products = localProductsMapped.length ? localProductsMapped : apiProducts;

    products.forEach(p => {
      // publishedAt from Shopify reflects current publish date (catches re-published products)
      p.stableTime =
        toTime(p.publishedAt) || latestProductTime(p);
    });

    // =========================
    // GROUP BRANDS
    // =========================

    const brandMap = {};

    products.forEach(product => {

      const vendor =
        product.vendor?.trim();

      if (!vendor) return;

      if (!brandMap[vendor]) {

        brandMap[vendor] = {

          title: vendor,
          products: [],
          latestDate: null,
          score: 0

        };

      }

      brandMap[vendor]
        .products
        .push(product);

    });

    // =========================
    // CALCULATE SCORES
    // =========================

    Object.values(brandMap)
      .forEach(brand => {

        const latestProduct =

          [...brand.products]

            .sort((a, b) =>

              (b.stableTime || 0) -
              (a.stableTime || 0)

            )[0];

        // =========================
        // LATEST DATE
        // =========================

        brand.latestDate =
          latestProduct?.stableTime
            ? new Date(latestProduct.stableTime)
            : null;

        brand.latestTime =
          latestProduct?.stableTime || 0;

        // =========================
        // BASE SCORE
        // =========================

        brand.score +=
          Math.min(
            brand.products.length * 100,
            3000
          );

        // =========================
        // ANALYTICS BOOST
        // =========================

        const analyticsBrand =

          analyticsMap[
          brand.title?.toLowerCase()
          ];

        if (analyticsBrand) {

          brand.score += Math.min(
            (analyticsBrand.searches || 0) * 80 +
            (analyticsBrand.clicks || 0) * 200,
            12000
          );

        }

        // =========================
        // RECENCY BOOST
        // =========================

        if (latestProduct?.stableTime) {

          const latestDate =
            latestProduct.stableTime;

          const daysOld =
            (
              Date.now() -
              latestDate
            ) /
            (1000 * 60 * 60 * 24);

          if (daysOld <= 1) {
            brand.score += 45000;
          } else if (daysOld <= 3) {
            brand.score += 35000;
          } else if (daysOld <= 7) {
            brand.score += 25000;
          } else if (daysOld <= 30) {
            brand.score += 12000;
          } else if (daysOld <= 90) {
            brand.score += 4000;
          } else if (daysOld > 365) {
            brand.score -= 15000;
          } else if (daysOld > 180) {
            brand.score -= 6000;
          }
        }
        // =========================
        // FEATURED BOOST
        // =========================

        const featured =

          featuredMap[
          brand.title?.toLowerCase()
          ];

        if (featured) {

          brand.score +=
            12000 +
            Math.min(featured.priority || 0, 8000);

        }

      });

    // =========================
    // FINAL BRANDS
    // Pinned brands always appear first (admin control)
    // =========================

    const allBrandsSorted =
      Object.values(brandMap)
        .sort((a, b) => {
          const aPinned = pinnedBrandNames.has(a.title?.toLowerCase());
          const bPinned = pinnedBrandNames.has(b.title?.toLowerCase());
          if (aPinned !== bPinned) return aPinned ? -1 : 1;
          if (b.score !== a.score) return b.score - a.score;
          return (b.latestTime || 0) - (a.latestTime || 0);
        });

    const brands =
      allBrandsSorted
        .slice(0, 10)
        .map(b => ({

          title:
            b.title,

          score:
            b.score,

          latestDate:
            b.latestDate,

          totalProducts:
            b.products.length,

          pinned:
            pinnedBrandNames.has(b.title?.toLowerCase())

        }));

    // =========================
    // TRENDING PRODUCTS
    // =========================

    const trendingProducts =

      [...products]

        .sort((a, b) =>

          (b.stableTime || 0) -
          (a.stableTime || 0)

        )

        .slice(0, 80);

    // =========================
    // RESPONSE
    // =========================

    const tbPayload = { brands, products: trendingProducts };
    trendingCache[tbCacheKey] = { data: tbPayload, timestamp: Date.now() };
    res.json(tbPayload);

  } catch (err) {

    console.error(
      "TRENDING BRANDS ERROR:",
      err
    );

    res.status(500).json({
      error: err.message
    });

  }

});

router.get("/trending", async (req, res) => {

  try {

    // =========================
    // STORE
    // =========================

    const { store, shop } = req.query;
    const rawStore = store || shop;

    if (!rawStore) {
      return res.status(400).json({ error: "Store is required" });
    }

    const cleanStore = normalizeDomain(rawStore);

    // =========================
    // TRENDING CACHE
    // =========================
    const tCacheKey = `trending|${cleanStore}`;
    const tCached = trendingCache[tCacheKey];
    if (tCached && Date.now() - tCached.timestamp < TRENDING_CACHE_TTL) {
      return res.json(tCached.data);
    }

    // =========================
    // PARALLEL: verify store + load settings (independent)
    // =========================
    const [storeExists, trendingSettings] = await Promise.all([
      Store.findOne({ domain: { $regex: new RegExp(`^${escapeRegex(cleanStore)}$`, "i") } }).lean(),
      TrendingSettings.findOne({ store: cleanStore }).lean()
    ]);

    if (!storeExists) {
      return res.json([]);
    }

    const windowDays = trendingSettings?.analyticsWindowDays || 7;
    const maxProducts = trendingSettings?.maxTrendingProducts || 12;
    const pinnedProductIds = new Set(trendingSettings?.pinnedProductIds || []);
    const excludedProductIds = new Set(trendingSettings?.excludedProductIds || []);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // =========================
    // PARALLEL: analytics + products (independent)
    // =========================
    const [analyticsData, dbProducts] = await Promise.all([
      Analytics.aggregate([
        {
          $match: {
            store: cleanStore,
            productId: { $exists: true, $ne: null },
            createdAt: { $gte: windowStart }
          }
        },
        {
          $group: {
            _id: "$productId",
            clicks: { $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] } },
            searches: { $sum: { $cond: [{ $eq: ["$type", "search"] }, 1, 0] } }
          }
        }
      ]),
      Product.find({
        store: cleanStore,
        status: "ACTIVE",
        ...(excludedProductIds.size && { productId: { $nin: Array.from(excludedProductIds) } })
      })
        .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
        .limit(500)
        .lean()
        .select(
          "productId title handle vendor image price " +
          "firstPublishedAt shopifyCreatedAt shopifyPublishedAt publishedAt status"
        )
    ]);

    const analyticsMap = {};
    analyticsData.forEach(item => {
      // Normalize key: strip GID prefix so "gid://shopify/Product/123" and "123" both map correctly
      const key = String(item._id || "").replace(/^gid:\/\/shopify\/Product\//, "");
      if (key) analyticsMap[key] = item;
    });

    // =========================
    // SCORE PRODUCTS
    // Analytics = PRIMARY signal, Recency = SECONDARY signal
    // =========================

    const scoredProducts = dbProducts.map(product => {

      let score = 0;

      const analytics = analyticsMap[String(product.productId)];

      if (analytics) {
        // Clicks worth much more — clicking = real purchase intent
        score += Math.min(
          (analytics.clicks || 0) * 8000 +
          (analytics.searches || 0) * 2000,
          400000
        );
      }

      const productTime = latestProductTime(product);
      const daysOld = daysSinceTime(productTime);

      if (daysOld <= 1) {
        score += 60000;
      } else if (daysOld <= 3) {
        score += 45000;
      } else if (daysOld <= 7) {
        score += 30000;
      } else if (daysOld <= 30) {
        score += 12000;
      } else if (daysOld <= 90) {
        score += 4000;
      } else if (daysOld > 365) {
        score -= 20000;
      }

      return {
        id: product.productId,
        title: product.title || "",
        handle: product.handle || "",
        vendor: product.vendor || "",
        image: product.image || "",
        price: product.price || 0,
        publishedAt: product.shopifyPublishedAt || product.publishedAt || null,
        createdAt: product.shopifyCreatedAt || null,
        status: product.status || "ACTIVE",
        score,
        stableTime: productTime
      };

    });

    // =========================
    // PINNED PRODUCTS FIRST, THEN DYNAMIC
    // =========================

    const pinned = scoredProducts.filter(p =>
      pinnedProductIds.has(String(p.id))
    );

    const dynamic = scoredProducts
      .filter(p => !pinnedProductIds.has(String(p.id)))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.stableTime || 0) - (a.stableTime || 0);
      })
      .slice(0, maxProducts - pinned.length);

    const trendingProducts = [...pinned, ...dynamic].slice(0, maxProducts);

    trendingCache[tCacheKey] = { data: trendingProducts, timestamp: Date.now() };
    res.json(trendingProducts);

  } catch (err) {

    console.error("TRENDING PRODUCTS ERROR:", err);
    res.status(500).json({ error: err.message });

  }

});

router.get("/trending-collections", async (req, res) => {
  try {
    const { store, shop, q, vendor, brand } = req.query;
    const rawStore = store || shop;

    if (!rawStore) {
      return res.json({ collections: [] });
    }

    const cleanStore = normalizeDomain(rawStore);
    const brandQuery = normalizeVendorName(vendor || brand || q || "");

    // =========================
    // SETTING CHECK — default OFF, admin must explicitly enable
    // =========================
    const tcSettings = await getSearchSettings(cleanStore);
    if (!tcSettings.aiSettings?.trendingCollectionsEnabled) {
      return res.json({ collections: [] });
    }

    // =========================
    // TRENDING COLLECTIONS CACHE
    // =========================
    const tcCacheKey = `trending-collections|${cleanStore}|${brandQuery}`;
    const tcCached = trendingCache[tcCacheKey];
    if (tcCached && Date.now() - tcCached.timestamp < TRENDING_CACHE_TTL) {
      return res.json(tcCached.data);
    }

    // =========================
    // PARALLEL: verify store + load settings (independent)
    // =========================
    const [matchedStores, trendingSettings] = await Promise.all([
      Store.find({ domain: { $regex: new RegExp(`^${escapeRegex(cleanStore)}$`, "i") } }).lean(),
      TrendingSettings.findOne({ store: cleanStore }).lean()
    ]);

    if (!matchedStores.length) {
      return res.json({ collections: [] });
    }

    const pinnedCollectionIds = trendingSettings?.pinnedCollectionIds || [];

    if (brandQuery) {
      const rawVendors = await Product.distinct("vendor", {
        store: cleanStore,
        status: "ACTIVE"
      });
      const detectedBrand = (rawVendors || []).find(v => {
        const normalizedVendor = normalizeVendorName(v);
        return normalizedVendor === brandQuery ||
          normalizedVendor.includes(brandQuery) ||
          brandQuery.includes(normalizedVendor);
      });

      if (detectedBrand) {
        const brandProducts = await Product.find({
          store: cleanStore,
          status: "ACTIVE",
          vendor: detectedBrand
        })
          .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
          .limit(300)
          .select("collections")
          .lean();

        const collectionIds = [
          ...new Set(
            brandProducts
              .flatMap(p => Array.isArray(p.collections) ? p.collections.map(id => String(id)) : [])
              .flatMap(id => {
                const plain = normalizeId(id);
                return [plain, `gid://shopify/Collection/${plain}`].filter(Boolean);
              })
          )
        ];

        if (collectionIds.length) {
          const brandCollections = await Collection.find({
            store: cleanStore,
            collectionId: { $in: collectionIds }
          }).lean();

          const formattedBrandCollections = brandCollections
            .filter(c => c.handle && c.title && c.title.trim() && c.title !== ".")
            .sort((a, b) => latestCollectionTime(b) - latestCollectionTime(a))
            .slice(0, 10)
            .map(c => ({ title: c.title, handle: c.handle, image: c.image || "" }));

          const tcPayload = { collections: formattedBrandCollections };
          trendingCache[`trending-collections|${cleanStore}|${brandQuery}`] = { data: tcPayload, timestamp: Date.now() };
          return res.json(tcPayload);
        }
      }
    }

    // =========================
    // PARALLEL: pinned + dynamic collections (independent)
    // =========================
    const [pinnedCollections, dynamicCollections] = await Promise.all([
      pinnedCollectionIds.length
        ? Collection.find({
          store: cleanStore,
          collectionId: { $in: pinnedCollectionIds.map(String) }
        }).lean()
        : Promise.resolve([]),
      Collection.find({
        store: cleanStore,
        ...(pinnedCollectionIds.length && {
          collectionId: { $nin: pinnedCollectionIds.map(String) }
        })
      })
        .sort({ shopifyPublishedAt: -1, firstPublishedAt: -1, shopifyCreatedAt: -1 })
        .limit(20)
        .lean()
    ]);

    const allCollections = [...pinnedCollections, ...dynamicCollections];

    const formattedCollections =
      allCollections
        .filter(c => c.handle && c.title && c.title.trim() && c.title !== ".")
        .sort((a, b) => latestCollectionTime(b) - latestCollectionTime(a))
        .slice(0, 10)
        .map(c => ({ title: c.title, handle: c.handle, image: c.image || "" }));

    const tcPayload = { collections: formattedCollections };
    trendingCache[tcCacheKey] = { data: tcPayload, timestamp: Date.now() };
    return res.json(tcPayload);

  } catch (err) {
    console.error("TRENDING COLLECTIONS ERROR:", err);
    res.status(500).json({ collections: [] });
  }
});


// =========================
// 🤖 AI SUGGESTIONS ROUTE
// GET /suggestions?q=shadi&shop=store.myshopify.com
// Returns autocomplete suggestions: popular queries + vendor matches + AI completions
// =========================
router.get("/suggestions", async (req, res) => {
  try {
    let { q, shop, store } = req.query;

    shop = (shop || store || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .trim()
      .toLowerCase();

    q = (q || "").trim();

    if (!shop) return res.json({ query: q, suggestions: [] });

    const settingsData = await getSearchSettings(shop);
    const aiSettings = settingsData.aiSettings || {};

    // Feature disabled by admin
    if (aiSettings.suggestionsEnabled === false) {
      return res.json({ query: q, suggestions: [] });
    }

    const modelName = SAFE_EXPANSION_MODELS.has(aiSettings.geminiModel)
      ? aiSettings.geminiModel
      : AI_FALLBACK_MODEL;

    // ─────────────────────────────────────────────────────────
    // EMPTY QUERY → homepage suggestions: manual + seasonal AI
    // ─────────────────────────────────────────────────────────
    if (q.length < 2) {
      const manual = (aiSettings.manualSuggestions || [])
        .map(s => ({ text: (s || "").toLowerCase().trim(), type: "manual" }))
        .filter(s => s.text.length >= 2);

      const seasonal = aiSettings.geminiEnabled !== false && process.env.GROQ_API_KEY
        ? await getSeasonalSuggestions(modelName)
        : [];

      const seen = new Set(manual.map(s => s.text));
      const seasonalMapped = seasonal
        .filter(s => !seen.has(s))
        .map(s => ({ text: s, type: "seasonal" }));

      return res.json({ query: q, suggestions: [...manual, ...seasonalMapped].slice(0, 8) });
    }

    const normalizedQ = q.toLowerCase();

    // Fire all three in parallel: AI + analytics + vendor matches
    const [aiSuggestions, popularQueries, matchingVendors] = await Promise.all([
      // 1. AI completions (only if AI enabled)
      aiSettings.geminiEnabled !== false && process.env.GROQ_API_KEY
        ? getAiSuggestions(normalizedQ, modelName)
        : Promise.resolve([]),

      // 2. Popular past queries that START WITH the typed text and returned results
      Analytics.aggregate([
        {
          $match: {
            store: shop,
            type: "search",
            normalizedQuery: { $regex: `^${escapeRegex(normalizedQ)}`, $options: "i" },
            resultsCount: { $gt: 0 }
          }
        },
        { $group: { _id: "$normalizedQuery", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),

      // 3. Vendor (brand) names that contain the typed text
      Product.distinct("vendor", {
        store: shop,
        status: "ACTIVE",
        vendor: { $regex: escapeRegex(normalizedQ), $options: "i" }
      })
    ]);

    const seen = new Set();
    const results = [];

    const push = (text, type) => {
      const t = (text || "").trim().toLowerCase();
      if (t.length < 2 || seen.has(t)) return;
      seen.add(t);
      results.push({ text: t, type });
    };

    // Priority 1 — popular real queries (highest intent signal)
    popularQueries.forEach(pq => push(pq._id, "popular"));

    // Priority 2 — vendor/brand name matches
    (matchingVendors || []).slice(0, 3).forEach(v => push(v, "vendor"));

    // Priority 3 — AI completions fill the rest
    aiSuggestions.forEach(s => push(s, "ai"));

    return res.json({ query: q, suggestions: results.slice(0, 8) });

  } catch (err) {
    console.error("SUGGESTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const _norm = (s) => (s || "").replace(/^https?:\/\//, "").replace(/\/$/, "").trim().toLowerCase();

const TYPO_SUGGESTION_CACHE_TTL = 1000 * 60 * 10;
const TYPO_CORPUS_CACHE_TTL = 1000 * 60 * 10;
const typoSuggestionCache = {};
const typoCorpusCache = {};

const normalizeSuggestionText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchUrl = (baseUrl, text) =>
  `${String(baseUrl || "https://nainpreet.com").replace(/\/$/, "")}/search?q=${encodeURIComponent(text)}`;

const cleanSuggestionTitle = (title) =>
  normalizeSuggestionText(title)
    .replace(/\brts\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d{2}\b/g, " ")
    .replace(/\b(drop|edit|vol|volume|chapter|collection|eid|summer|winter|spring|festive)\b/g, " ")
    .replace(/\b[a-z]{1,2}\d+[a-z]?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SUGGESTION_STOP_PHRASES = [
  /^new in\b/,
  /^ready to ship\b/,
  /^with\b/,
  /^all\b/,
  /^shop by\b/,
  /\bin warehouse\b/,
  /\brtw\d*\b/,
  /\bready to ship\b/,
  /\bnew arrivals?\b/,
  /\bdefault title\b/,
  /\badd ons?\b/,
  /\bdo not delete\b/,
  /\bsmart products filter\b/
];

const SUGGESTION_FABRICS = new Set([
  "lawn", "chiffon", "organza", "silk", "raw silk", "cotton", "cambric",
  "net", "velvet", "khaddar", "karandi", "jacquard", "tissue", "linen"
]);

const SUGGESTION_OCCASIONS = new Set([
  "formal", "formals", "bridal", "festive", "party", "casual", "pret",
  "luxury", "luxury pret", "unstitched", "stitched"
]);

const isCleanSuggestionPhrase = (text) => {
  const clean = normalizeSuggestionText(text);
  if (clean.length < 2 || clean.length > 55) return false;
  if (/^\d+$/.test(clean)) return false;
  if (SUGGESTION_STOP_PHRASES.some(re => re.test(clean))) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false;
  if (tokens.some(t => t.length === 1 && !["a"].includes(t))) return false;
  return true;
};

const suggestionCategoryRank = {
  brand: 100,
  latest: 92,
  product: 88,
  fabric: 84,
  color: 80,
  product_type: 76,
  tag: 60
};

const suggestionTokenScore = (query, candidate) => {
  const q = normalizeSuggestionText(query);
  const c = normalizeSuggestionText(candidate);
  if (!q || !c || c.length < 2) return 0;
  if (q === c) return 100;
  if (c.startsWith(q)) return 92;
  if (c.includes(q)) return 84;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const cTokens = c.split(/\s+/).filter(Boolean);
  const tokenScores = qTokens.map(qt => {
    let best = stringSimilarity.compareTwoStrings(qt, c);
    cTokens.forEach(ct => {
      if (ct.startsWith(qt)) best = Math.max(best, 0.90);
      if (ct.includes(qt) || qt.includes(ct)) best = Math.max(best, 0.82);
      best = Math.max(best, stringSimilarity.compareTwoStrings(qt, ct));
    });
    return best;
  });
  const avgToken = tokenScores.reduce((sum, n) => sum + n, 0) / Math.max(tokenScores.length, 1);
  const phrase = stringSimilarity.compareTwoStrings(q, c);
  return Math.round(Math.max(avgToken, phrase) * 100);
};

const getTypoSuggestionCorpus = async (shop) => {
  const cached = typoCorpusCache[shop];
  if (cached && Date.now() - cached.timestamp < TYPO_CORPUS_CACHE_TTL) {
    return cached.data;
  }

  const baseMatch = { store: shop, status: "ACTIVE" };
  const hasFreshVendorCache =
    vendorCache[shop] && Date.now() - vendorCache[shop].timestamp < CACHE_TIME;
  const [rawVendors, recentProducts] = await Promise.all([
    hasFreshVendorCache
      ? Promise.resolve(vendorCache[shop].data)
      : Product.distinct("vendor", baseMatch),
    Product.find(baseMatch)
      .sort({ firstPublishedAt: -1, shopifyPublishedAt: -1, publishedAt: -1, shopifyCreatedAt: -1 })
      .limit(300)
      .select("title vendor productType tags colors")
      .lean()
  ]);

  const vendors = (rawVendors || []).filter(Boolean);
  if (!hasFreshVendorCache) {
    vendorCache[shop] = { data: vendors, timestamp: Date.now() };
  }

  const productTypes = new Set();
  const colorCounts = new Map();
  const tagCounts = new Map();
  recentProducts.forEach(product => {
    if (product.productType) productTypes.add(product.productType);
    (product.colors || []).forEach(color => {
      colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
    });
    (product.tags || []).forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  const data = {
    vendors,
    productTypes: [...productTypes],
    colorDocs: [...colorCounts].map(([value, count]) => ({ _id: value, count })),
    tagDocs: [...tagCounts].map(([value, count]) => ({ _id: value, count })),
    recentProducts
  };
  typoCorpusCache[shop] = { data, timestamp: Date.now() };
  return data;
};

async function getTypoAiSuggestions({ query, candidates, modelName, apiKey }) {
  if (!apiKey || !candidates.length) return [];
  try {
    const prompt = `You correct fuzzy fashion search queries for a Shopify Pakistani fashion store.
Return ONLY a JSON array of 1-5 suggestion strings.
Rules:
- Suggestions must be selected from or closely based on DB candidates.
- Do not invent brands/products/colors not present in candidates.
- Prefer short searchable phrases.
- If query already looks correct, return [].

Query: "${query}"
DB candidates:
${candidates.slice(0, 30).map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`;

    const response = await Promise.race([
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 160,
          temperature: 0
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Typo AI timeout")), 1600))
    ]);
    if (!response.ok) return [];
    const json = await response.json();
    const text = (json?.choices?.[0]?.message?.content || "").trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    return JSON.parse(match[0])
      .map(normalizeSuggestionText)
      .filter(Boolean)
      .slice(0, 5);
  } catch (err) {
    console.warn("[Typo Suggestions] AI skipped:", err.message);
    return [];
  }
}

router.get("/typo-suggestions", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const shop = _norm(req.query.shop || req.query.store);
    const query = normalizeSuggestionText(req.query.q || req.query.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
    const storefrontBase = req.query.domain || req.query.site || req.query.baseUrl || "https://nainpreet.com";
    if (!shop || query.length < 2) {
      return res.json({ success: true, enabled: true, query, suggestions: [] });
    }

    const [settingsData, typoCorpus] = await Promise.all([
      getSearchSettings(shop),
      getTypoSuggestionCorpus(shop)
    ]);
    const searchSettings = settingsData.searchSettings || {};
    const aiSettings = settingsData.aiSettings || {};
    const enabled = searchSettings.typoSuggestionsEnabled !== false;
    if (!enabled) {
      return res.json({ success: true, enabled: false, query, suggestions: [] });
    }

    const cacheKey = `${shop}|${query}|${limit}|${storefrontBase}|${searchSettings.typoSuggestionsAiEnabled !== false}`;
    const cached = typoSuggestionCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < TYPO_SUGGESTION_CACHE_TTL) {
      return res.json(cached.data);
    }

    const {
      vendors,
      productTypes,
      colorDocs,
      tagDocs,
      recentProducts
    } = typoCorpus;

    const candidates = new Map();
    const addCandidate = (text, source, count = 1, category = source) => {
      const clean = normalizeSuggestionText(text);
      if (!isCleanSuggestionPhrase(clean)) return;
      if (/^(new|all|sale|products?|collection|collections?)$/.test(clean)) return;
      const score = suggestionTokenScore(query, clean);
      if (score < 45) return;
      const boostedScore = score + (suggestionCategoryRank[category] || 0);
      const existing = candidates.get(clean);
      if (!existing || boostedScore > existing.score) {
        candidates.set(clean, { text: clean, source, category, score: boostedScore, matchScore: score, count });
      }
    };
    const addProductSuggestionPhrases = (p) => {
      const vendor = normalizeSuggestionText(p.vendor);
      const title = cleanSuggestionTitle(p.title);
      const productType = normalizeSuggestionText(p.productType);
      const colors = (p.colors || []).map(normalizeSuggestionText).filter(Boolean);
      const tagTokens = (p.tags || [])
        .map(normalizeSuggestionText)
        .filter(Boolean)
        .flatMap(tag => tag.split(/\s*[-:]\s*/).map(normalizeSuggestionText))
        .filter(Boolean);

      if (vendor) {
        addCandidate(vendor, "vendor", 8, "brand");
        addCandidate(`latest ${vendor}`, "latest", 5, "latest");
      }

      if (title && suggestionTokenScore(query, title) >= 75) {
        addCandidate(title, "product", 3, "product");
      }

      if (vendor && title && !title.includes(vendor) && suggestionTokenScore(query, title) >= 82) {
        addCandidate(`${title} ${vendor}`, "product", 3, "product");
      }

      if (vendor && productType && isCleanSuggestionPhrase(productType)) {
        addCandidate(`${vendor} ${productType}`, "product_type", 4, "product_type");
      }

      colors.slice(0, 3).forEach(color => {
        if (vendor) addCandidate(`${vendor} ${color}`, "color", 3, "color");
        addCandidate(`${color} ${productType || "dress"}`, "color", 2, "color");
      });

      tagTokens.slice(0, 25).forEach(tag => {
        const cleanTag = tag
          .replace(/\bnew in\b/g, " ")
          .replace(/\brtw\d*\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!isCleanSuggestionPhrase(cleanTag)) return;
        if (SUGGESTION_FABRICS.has(cleanTag)) {
          addCandidate(cleanTag, "fabric", 2, "fabric");
          if (vendor) addCandidate(`${vendor} ${cleanTag}`, "fabric", 5, "fabric");
          addCandidate(`${cleanTag} ${productType || "dress"}`, "fabric", 2, "fabric");
          return;
        }
        if (SUGGESTION_OCCASIONS.has(cleanTag)) {
          addCandidate(cleanTag, "tag", 2, "tag");
          if (vendor) addCandidate(`${vendor} ${cleanTag}`, "tag", 4, "tag");
          return;
        }
      });
    };

    vendors.forEach(v => {
      const vendor = normalizeSuggestionText(v);
      addCandidate(vendor, "vendor", 3, "brand");
      addCandidate(`latest ${vendor}`, "latest", 2, "latest");
    });
    productTypes.forEach(t => addCandidate(t, "product_type", 1, "product_type"));
    colorDocs.forEach(c => addCandidate(c._id, "color", c.count || 1, "color"));
    tagDocs.forEach(t => {
      const tag = normalizeSuggestionText(t._id);
      if (SUGGESTION_FABRICS.has(tag)) addCandidate(tag, "fabric", t.count || 1, "fabric");
      else if (SUGGESTION_OCCASIONS.has(tag)) addCandidate(tag, "tag", t.count || 1, "tag");
    });
    recentProducts.forEach(addProductSuggestionPhrases);

    const rankedCandidates = [...candidates.values()]
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, 40);

    const queryTokens = query.split(/\s+/).filter(Boolean);
    const hasStrongAutocompleteMatch = rankedCandidates.some(c =>
      c.score >= 90 &&
      (
        c.text.startsWith(query) ||
        query.startsWith(c.text)
      )
    );
    const shouldUseTypoAi =
      queryTokens.length >= 2 &&
      queryTokens.length <= 3 &&
      query.length >= 6 &&
      !hasStrongAutocompleteMatch;

    const aiAllowed =
      searchSettings.typoSuggestionsAiEnabled !== false &&
      aiSettings.geminiEnabled !== false &&
      Boolean(process.env.GROQ_API_KEY) &&
      shouldUseTypoAi &&
      rankedCandidates.length > 0;
    const modelName = SAFE_EXPANSION_MODELS.has(aiSettings.geminiModel)
      ? aiSettings.geminiModel
      : AI_PRIMARY_MODEL;
    const aiTexts = aiAllowed
      ? await getTypoAiSuggestions({
        query,
        candidates: rankedCandidates,
        modelName,
        apiKey: process.env.GROQ_API_KEY
      })
      : [];

    const byText = new Map(rankedCandidates.map(c => [c.text, c]));
    const suggestions = [
      ...aiTexts.map(text => ({
        text,
        type: "ai_typo",
        score: byText.get(text)?.score || suggestionTokenScore(query, text),
        source: byText.get(text)?.source || "ai",
        category: byText.get(text)?.category || "ai"
      })),
      ...rankedCandidates.map(c => ({
        text: c.text,
        type: "db_typo",
        score: c.score,
        matchScore: c.matchScore,
        source: c.source,
        category: c.category,
        count: c.count
      }))
    ]
      .filter((item, index, arr) => arr.findIndex(x => x.text === item.text) === index)
      .filter(item => item.text !== query)
      .slice(0, limit)
      .map(item => ({
        ...item,
        url: buildSearchUrl(storefrontBase, item.text)
      }));

    const payload = {
      success: true,
      enabled: true,
      title: "Suggestions",
      query,
      aiUsed: aiTexts.length > 0,
      mode: aiTexts.length > 0 ? "ai_refined" : "db_autocomplete",
      aiSkippedReason: aiTexts.length > 0
        ? null
        : (!shouldUseTypoAi
          ? (hasStrongAutocompleteMatch ? "strong_db_match" : "live_typing_or_single_word")
          : "disabled_or_unavailable"),
      suggestions,
      groups: suggestions.reduce((acc, item) => {
        const key = item.category || item.source || "other";
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {}),
      links: suggestions.map(item => `[${item.text}](${item.url})`)
    };
    typoSuggestionCache[cacheKey] = { data: payload, timestamp: Date.now() };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.clearSettingsCache = (shop) => {
  const s = _norm(shop);
  delete settingsCache[s];
  delete filterConfigCache[s];
};

router.clearTrendingCache = (shop) => {
  const s = _norm(shop);
  Object.keys(trendingCache).forEach(k => { if (k.includes(`|${s}`)) delete trendingCache[k]; });
};

router.clearSearchCache = (shop) => {
  const s = _norm(shop);
  delete filterConfigCache[s];
  delete typoCorpusCache[s];
  Object.keys(searchCache).forEach(k => {
    if (k.startsWith(`${s}|`) || k.includes(`|${s}|`)) delete searchCache[k];
  });
  Object.keys(typoSuggestionCache).forEach(k => {
    if (k.startsWith(`${s}|`)) delete typoSuggestionCache[k];
  });
};

module.exports = router;
