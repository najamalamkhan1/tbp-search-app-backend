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
