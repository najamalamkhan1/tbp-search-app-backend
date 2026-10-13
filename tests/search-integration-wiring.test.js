const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("search route uses generic vendor resolver and unconditional requested tag filter", () => {
  const source = read("Routes/search.js");
  assert.match(source, /resolveVendor\(normalizedQuery, uniqueVendors, NON_VENDOR_KEYWORDS\)/);
  assert.match(source, /if \(requestedTagFilter\) \{/);
  assert.doesNotMatch(source, /if \(requestedTagFilter && isFilterActive\("tag"\)\)/);
  assert.match(source, /normalizedTags: \{ \$in: normalizedRequestedTags \}/);
  assert.match(source, /requestedTagSet\.has\(tag\)/);
  assert.match(source, /finalRequestedTags\.has\(tag\)/);
});

test("sync and webhook paths persist normalized vendor and tags", () => {
  for (const file of ["Routes/productsRoute.js", "Routes/webhookRoutes.js"]) {
    const source = read(file);
    assert.match(source, /normalizedVendor/);
    assert.match(source, /normalizedTags/);
  }
});

test("product mutations invalidate search and trending caches", () => {
  const source = read("Routes/webhookRoutes.js");
  assert.match(source, /clearTrendingCache\(shop\)/);
  assert.match(source, /clearSearchCache\(shop\)/);
});

test("trending brands does not block on live Shopify results", () => {
  const source = read("Routes/search.js");
  assert.match(source, /const results = \[\];/);
  assert.match(source, /Avoid a Shopify Admin API call/);
});

test("final response preserves relevance sorting after deduplication", () => {
  const source = read("Routes/search.js");
  assert.match(source, /matchPriority: calculateMatchPriority/);
  assert.match(source, /products\.sort\([\s\S]*?defaultSort === "relevance"[\s\S]*?sortByRelevance/);
  assert.doesNotMatch(source, /products = dedupeProducts\(products\);\s*products\.sort\(sortNewestFirst\);/);
  assert.match(source, /normalizedQuery && configuredSort === "newest"[\s\S]*?"relevance"/);
});

test("brand plus title searches fetch strict title candidates and skip collection injection", () => {
  const source = read("Routes/search.js");
  assert.match(source, /if \(detectedVendor && remainingTokens\.length\) \{[\s\S]*?orderedTitlePattern/);
  assert.match(source, /normalizeSearchText\(product\.vendor\) === normalizeSearchText\(detectedVendor\)/);
  assert.match(source, /if \(detectedVendor && collections\.length && !remainingTokens\.length\)/);
});

test("query colors can match product titles without weakening explicit color filters", () => {
  const source = read("Routes/search.js");
  assert.match(source, /SEARCH_RANKING_VERSION = "title-color-parallel-v5"/);
  assert.match(source, /allowTitleColorMatch = localColors\.length > 0 && selectedColorTerms\.length === 0/);
  assert.match(source, /titleMatchesColor = allowTitleColorMatch/);
  assert.match(source, /if \(allowTitleColorMatch && dbColorTerms\.some/);
});
