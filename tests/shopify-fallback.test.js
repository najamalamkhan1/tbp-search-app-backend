const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fallback = require("../utils/shopifyFallback");

const SHOP = "demo-store.myshopify.com";

const node = (overrides = {}) => ({
  id: "gid://shopify/Product/101",
  title: "Maria B Red Embroidered Suit",
  handle: "maria-b-red-suit",
  vendor: "Maria B",
  productType: "Formal",
  tags: ["red", "formal"],
  status: "ACTIVE",
  createdAt: "2026-11-10T10:00:00Z",
  publishedAt: "2026-11-12T10:00:00Z",
  totalInventory: 5,
  tracksInventory: true,
  featuredImage: { url: "https://cdn.example.com/a.jpg" },
  variants: { edges: [{ node: { price: "15000.00" } }] },
  ...overrides,
});

const edges = (...nodes) => nodes.map((n) => ({ node: n }));

/** Fake fetch that answers by inspecting the GraphQL text. */
function makeFetch(handlers, calls = []) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    for (const [needle, respond] of handlers) {
      if (body.query.includes(needle)) {
        const result = typeof respond === "function" ? respond(body) : respond;
        if (result instanceof Error) throw result;
        if (result && result.__status) return { ok: false, status: result.__status, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => result };
      }
    }
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
}

test.beforeEach(() => {
  fallback._resetForTests();
  fallback._setStoreLookupForTests(async () => ({ domain: SHOP, accessToken: "tok" }));
  delete process.env.SHOPIFY_FALLBACK_ENABLED;
});

test("mapNodeToProduct returns the Mongo-shaped product", () => {
  const product = fallback.mapNodeToProduct(node());
  assert.equal(product.productId, "101");
  assert.equal(product.vendor, "Maria B");
  assert.equal(product.price, 15000);
  assert.equal(product.stock, 5);
  assert.equal(product.availableForSale, true);
  assert.equal(product.status, "ACTIVE");
  assert.equal(product.image, "https://cdn.example.com/a.jpg");
  assert.ok(product.firstPublishedAt instanceof Date);
  assert.equal(product.latestTime, new Date("2026-11-12T10:00:00Z").getTime());
});

test("mapNodeToProduct treats untracked inventory as available and zero stock as sold out", () => {
  assert.equal(fallback.mapNodeToProduct(node({ totalInventory: 0, tracksInventory: false })).availableForSale, true);
  assert.equal(fallback.mapNodeToProduct(node({ totalInventory: 0, tracksInventory: true })).availableForSale, false);
});

test("buildSearchQueries makes a strict query and a relaxed fallback query", () => {
  const [strict, relaxed] = fallback.buildSearchQueries({ phrases: ["lal shadi"] });
  assert.match(strict, /^status:active AND /);
  assert.match(strict, /title:lal\* OR tag:lal/);
  assert.ok(strict.includes(" AND (title:shadi*"));
  assert.ok(relaxed.includes(") OR ("));
});

test("buildSearchQueries supports vendor-only and escapes quotes", () => {
  const [vendorOnly] = fallback.buildSearchQueries({ phrases: [], vendor: 'Maria "B"' });
  assert.equal(vendorOnly, 'status:active AND vendor:"Maria \\"B\\""');
  assert.deepEqual(fallback.buildSearchQueries({ phrases: [] }), []);
  // symbols cannot inject operators
  const [q] = fallback.buildSearchQueries({ phrases: ['red) OR (vendor:x'] });
  assert.ok(!q.includes("vendor:x"));
});

test("matchVendors resolves exact, prefix and typo vendors and ignores garbage words", () => {
  const vendors = ["Maria B", "Sana Safinaz", "Khaadi"];
  assert.equal(fallback.matchVendors("maria b", vendors).best, "Maria B");
  assert.equal(fallback.matchVendors("sana", vendors).best, "Sana Safinaz");
  assert.equal(fallback.matchVendors("khadi", vendors).list[0].title, "Khaadi");
  assert.equal(fallback.matchVendors("lawn", vendors, new Set(["lawn"])).best, null);
});

test("searchFallback returns ranked, live, de-duplicated products with vendors and collections", async () => {
  const calls = [];
  fallback._setFetchForTests(makeFetch([
    ["productVendors", { data: { shop: { productVendors: { edges: [{ node: "Maria B" }, { node: "Add Ons" }] } } } }],
    ["collections(", { data: { collections: { edges: edges(
      { title: "Maria B Eid", handle: "maria-b-eid", image: { url: "i.jpg" } },
      { title: "Do Not Delete", handle: "dnd", image: null },
      { title: "RTS Maria", handle: "rts-maria", image: null }
    ) } } }],
    ["products(", { data: { products: { edges: edges(
      node({ id: "gid://shopify/Product/1", title: "Plain Kurta", tags: [] }),
      node({ id: "gid://shopify/Product/2", title: "Maria B Red Suit" }),
      node({ id: "gid://shopify/Product/2", title: "Maria B Red Suit" }),
      node({ id: "gid://shopify/Product/3", title: "Draft Suit", status: "DRAFT" }),
      node({ id: "gid://shopify/Product/4", title: "Unpublished Suit", publishedAt: null }),
      node({ id: "gid://shopify/Product/5", title: "Add On", vendor: "Add Ons" })
    ) } } }],
  ], calls));

  const result = await fallback.searchFallback({ shop: SHOP, query: "maria b red" });
  assert.ok(result);
  assert.deepEqual(result.products.map((p) => p.productId), ["2", "1"]);
  assert.equal(result.products[0].fromFallback, true);
  assert.equal(result.detectedVendor, "Maria B");
  assert.equal(result.vendors[0].title, "Maria B");
  assert.deepEqual(result.collections.map((c) => c.handle), ["maria-b-eid"]); // garbage + RTS removed
  assert.ok(calls.every((c) => c.url === `https://${SHOP}/admin/api/2026-04/graphql.json`));
});

test("searchFallback applies price and stock filters client-side", async () => {
  fallback._setFetchForTests(makeFetch([
    ["productVendors", { data: { shop: { productVendors: { edges: [] } } } }],
    ["collections(", { data: { collections: { edges: [] } } }],
    ["products(", { data: { products: { edges: edges(
      node({ id: "gid://shopify/Product/1", variants: { edges: [{ node: { price: "5000" } }] } }),
      node({ id: "gid://shopify/Product/2", variants: { edges: [{ node: { price: "25000" } }] } }),
      node({ id: "gid://shopify/Product/3", totalInventory: 0, variants: { edges: [{ node: { price: "6000" } }] } })
    ) } } }],
  ]));
  const result = await fallback.searchFallback({
    shop: SHOP, query: "suit", filters: { maxPrice: 10000, inStockOnly: true },
  });
  assert.deepEqual(result.products.map((p) => p.productId), ["1"]);
});

test("searchFallback tries the relaxed query when the strict one finds nothing", async () => {
  const seen = [];
  fallback._setFetchForTests(makeFetch([
    ["productVendors", { data: { shop: { productVendors: { edges: [] } } } }],
    ["collections(", { data: { collections: { edges: [] } } }],
    ["products(", (body) => {
      seen.push(body.variables.q);
      return { data: { products: { edges: seen.length === 1 ? [] : edges(node()) } } };
    }],
  ]));
  const result = await fallback.searchFallback({ shop: SHOP, query: "red unknownword" });
  assert.equal(seen.length, 2);
  assert.equal(result.products.length, 1);
});

test("searchFallback returns null on HTTP failure and opens the circuit breaker after repeated failures", async () => {
  let hits = 0;
  fallback._setFetchForTests(async () => { hits += 1; return { ok: false, status: 500, json: async () => ({}) }; });
  for (let i = 0; i < fallback._constants.BREAKER_THRESHOLD; i += 1) {
    assert.equal(await fallback.shopifyGraphql(SHOP, "{ shop { name } }"), null);
  }
  const before = hits;
  assert.equal(await fallback.shopifyGraphql(SHOP, "{ shop { name } }"), null);
  assert.equal(hits, before, "no request is sent while the circuit is open");
  assert.deepEqual(await fallback.fetchLatestProducts(SHOP), []);
});

test("GraphQL errors and thrown fetches never throw to the caller", async () => {
  fallback._setFetchForTests(async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "boom" }] }) }));
  assert.equal(await fallback.shopifyGraphql(SHOP, "{ x }"), null);
  fallback._resetForTests();
  fallback._setStoreLookupForTests(async () => ({ domain: SHOP, accessToken: "tok" }));
  fallback._setFetchForTests(async () => { throw new Error("network down"); });
  assert.equal(await fallback.shopifyGraphql(SHOP, "{ x }"), null);
});

test("requests that exceed the timeout are aborted", async () => {
  fallback._setFetchForTests((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));
  const started = Date.now();
  assert.equal(await fallback.shopifyGraphql(SHOP, "{ x }", {}, { timeoutMs: 50 }), null);
  assert.ok(Date.now() - started < 1000);
});

test("missing store or kill switch means no network call", async () => {
  let hits = 0;
  fallback._setFetchForTests(async () => { hits += 1; return { ok: true, json: async () => ({ data: {} }) }; });

  fallback._setStoreLookupForTests(async () => null);
  assert.equal(await fallback.shopifyGraphql(SHOP, "{ x }"), null);

  fallback._setStoreLookupForTests(async () => ({ domain: SHOP, accessToken: "tok" }));
  process.env.SHOPIFY_FALLBACK_ENABLED = "false";
  assert.equal(await fallback.searchFallback({ shop: SHOP, query: "red" }), null);
  assert.deepEqual(await fallback.fetchLatestProducts(SHOP), []);
  assert.equal(hits, 0);
});

test("fetchLatestProducts returns only live, non-garbage products and caches the result", async () => {
  let hits = 0;
  fallback._setFetchForTests(makeFetch([
    ["products(", () => {
      hits += 1;
      return { data: { products: { edges: edges(
        node({ id: "gid://shopify/Product/1" }),
        node({ id: "gid://shopify/Product/2", publishedAt: null }),
        node({ id: "gid://shopify/Product/3", vendor: "Test Vendor" })
      ) } } };
    }],
  ]));
  const first = await fallback.fetchLatestProducts(SHOP, 50);
  const second = await fallback.fetchLatestProducts(SHOP, 50);
  assert.deepEqual(first.map((p) => p.productId), ["1"]);
  assert.equal(second.length, 1);
  assert.equal(hits, 1);
});

test("search route keeps Mongo primary and only calls the fallback when results are empty", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "Routes/search.js"), "utf8");
  assert.match(source, /require\("\.\.\/utils\/shopifyFallback"\)/);
  assert.match(source, /if \(products\.length === 0\) \{\s*const fbVendors/);
  assert.match(source, /if \(!localProductsMapped\.length\) \{\s*const fallbackProducts = await shopifyFallback\.fetchLatestProducts/);
  assert.match(source, /if \(!dbProducts\.length\) \{\s*const fallbackProducts = await shopifyFallback\.fetchLatestProducts/);
  assert.match(source, /if \(!fallbackActive\) \{\s*searchCache\[cacheKey\]/);
});
