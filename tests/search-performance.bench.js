const { performance } = require("node:perf_hooks");
const {
  compareAvailableLatest,
  normalizeSearchText,
  normalizeTag,
  resolveVendor,
} = require("../utils/searchRanking");

const vendorCount = 5000;
const productCount = 50000;
const iterations = 200;
const vendors = Array.from({ length: vendorCount }, (_, index) => `Designer Studio ${index}`);
vendors.push("Lira Studio", "Sana Safinaz");
const products = Array.from({ length: productCount }, (_, index) => ({
  title: `Product ${index}`,
  stock: index % 5 === 0 ? 0 : 1,
  latestTime: Date.now() - index * 1000,
  score: index % 100,
}));

const started = performance.now();
for (let index = 0; index < iterations; index += 1) {
  resolveVendor(index % 2 ? "lira stu" : "sana saf", vendors);
  normalizeSearchText(" Latest Formal-Wear ");
  normalizeTag("Formals");
}
const normalizationMs = performance.now() - started;

const sortStarted = performance.now();
products.sort(compareAvailableLatest);
const sortMs = performance.now() - sortStarted;

const report = {
  vendorCount,
  productCount,
  iterations,
  vendorResolutionAndNormalizationMs: Number(normalizationMs.toFixed(2)),
  averageVendorResolutionMs: Number((normalizationMs / iterations).toFixed(3)),
  rankSortMs: Number(sortMs.toFixed(2)),
  firstProductAvailable: products[0].stock > 0,
  lastProductSoldOut: products[products.length - 1].stock === 0,
};

console.log(JSON.stringify(report, null, 2));

if (!report.firstProductAvailable || !report.lastProductSoldOut || report.averageVendorResolutionMs > 25) {
  process.exitCode = 1;
}
