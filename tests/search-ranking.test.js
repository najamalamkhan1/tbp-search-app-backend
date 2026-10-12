const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateMatchPriority,
  compareAvailableLatest,
  normalizeSearchText,
  normalizeTag,
  productIsAvailable,
  resolveVendor,
} = require("../utils/searchRanking");

const vendors = ["Lira Studio", "Sana Safinaz", "Maria B", "Elan Official"];

test("normalizes punctuation, spacing and case", () => {
  assert.equal(normalizeSearchText("  LIRA--Studio  "), "lira studio");
  assert.equal(normalizeSearchText("Sana & Safinaz"), "sana and safinaz");
});

test("resolves partial and complete multi-word brands without hard-coding", () => {
  assert.equal(resolveVendor("lir", vendors), "Lira Studio");
  assert.equal(resolveVendor("lira", vendors), "Lira Studio");
  assert.equal(resolveVendor("lira stu", vendors), "Lira Studio");
  assert.equal(resolveVendor("sana saf", vendors), "Sana Safinaz");
  assert.equal(resolveVendor("maria b formal", vendors), "Maria B");
});

test("does not turn ignored generic terms into a brand", () => {
  const ignored = new Set(["formal", "dress", "latest"]);
  assert.equal(resolveVendor("formal dress", vendors, ignored), null);
});

test("normalizes common tag spelling variants", () => {
  assert.equal(normalizeTag(" Formal-Wear "), "formal wear");
  assert.equal(normalizeTag("Formals"), "formal");
});

test("availability recognizes stock and continue-selling variants", () => {
  assert.equal(productIsAvailable({ stock: 2 }), true);
  assert.equal(productIsAvailable({ stock: 0, availableForSale: false }), false);
  assert.equal(productIsAvailable({ variantsInventory: [{ inventoryPolicy: "CONTINUE" }] }), true);
});

test("available products rank before newer sold-out products", () => {
  const products = [
    { title: "new sold out", stock: 0, latestTime: 300 },
    { title: "older available", stock: 2, latestTime: 100 },
    { title: "new available", availableForSale: true, latestTime: 200 },
  ].sort(compareAvailableLatest);

  assert.deepEqual(products.map(product => product.title), [
    "new available",
    "older available",
    "new sold out",
  ]);
});

test("latest date wins within the same availability group", () => {
  const products = [
    { title: "old", stock: 1, latestTime: 100 },
    { title: "latest", stock: 1, latestTime: 200 },
  ].sort(compareAvailableLatest);
  assert.equal(products[0].title, "latest");
});

test("direct title and tag fabric matches outrank description-only matches", () => {
  const titleMatch = calculateMatchPriority({ title: "Pure Silk Shirt" }, "silk");
  const tagMatch = calculateMatchPriority({ title: "Embroidered Suit", tags: ["Silk"] }, "silk");
  const descriptionMatch = calculateMatchPriority({ title: "Velvet Suit", description: "Includes silk trouser" }, "silk");

  assert.ok(titleMatch > tagMatch);
  assert.ok(tagMatch > descriptionMatch);
});

test("multi-word title prefixes receive direct title priority", () => {
  assert.equal(
    calculateMatchPriority({ title: "Lira Studio Festive Edit" }, "lira stu"),
    650
  );
});
