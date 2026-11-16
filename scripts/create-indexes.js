// Usage: node scripts/create-indexes.js [--apply] [--drop-redundant]
// Default is a dry run. --apply creates missing indexes one at a time; --drop-redundant also drops REDUNDANT below.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

// Dropped only when the covering index (same key prefix) already exists.
const REDUNDANT = {
  Product: [{ name: "store_1", coveredBy: { store: 1, productId: 1 } }],
  Analytics: [
    { name: "store_1", coveredBy: { store: 1, type: 1, createdAt: -1, normalizedQuery: 1 } },
    { name: "vendor_1", coveredBy: { vendor: 1, createdAt: -1 } },
    { name: "normalizedQuery_1", coveredBy: { normalizedQuery: 1, createdAt: -1 } },
    { name: "store_1_type_1_createdAt_-1", coveredBy: { store: 1, type: 1, createdAt: -1, normalizedQuery: 1 } },
  ],
};

const defaultName = (keys) => Object.entries(keys).map(([k, v]) => `${k}_${v}`).join("_");
const sameKeys = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
const isPrefix = (prefix, keys) => {
  const p = Object.entries(prefix);
  const k = Object.entries(keys);
  return p.length <= k.length && p.every(([key, v], i) => k[i][0] === key && k[i][1] === v);
};

function planIndexes(schemaIndexes, existing, redundant = []) {
  const toCreate = [];
  for (const [keys, options = {}] of schemaIndexes) {
    const name = options.name || defaultName(keys);
    const isText = Object.values(keys).includes("text");
    const found = existing.some((ix) => ix.name === name || (!isText && sameKeys(ix.key, keys)));
    if (!found) toCreate.push({ keys, options: { ...options, name, background: undefined } });
  }
  const toDrop = redundant.filter(
    (r) =>
      existing.some((ix) => ix.name === r.name) &&
      existing.some((ix) => ix.name !== r.name && isPrefix(r.coveredBy, ix.key))
  );
  return { toCreate, toDrop };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dropRedundant = process.argv.includes("--drop-redundant");
  for (const f of fs.readdirSync(path.join(__dirname, "..", "Models"))) require(`../Models/${f}`);
  await mongoose.connect(process.env.MONGO_DB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(apply ? "MODE: apply" : "MODE: dry run (pass --apply to change anything)");

  for (const modelName of mongoose.modelNames()) {
    const model = mongoose.model(modelName);
    const coll = model.collection;
    let existing = [];
    try { existing = await coll.indexes(); } catch (e) { if (e.codeName !== "NamespaceNotFound") throw e; }
    const { toCreate, toDrop } = planIndexes(model.schema.indexes(), existing, REDUNDANT[modelName]);
    console.log(`\n[${modelName}] existing=${existing.length} missing=${toCreate.length} redundant=${toDrop.length}`);
    for (const { keys, options } of toCreate) {
      console.log("  create:", options.name);
      if (!apply) continue;
      const t = Date.now();
      const opts = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
      await coll.createIndex(keys, opts);
      console.log(`    done in ${Date.now() - t}ms`);
    }
    for (const r of toDrop) {
      console.log("  drop (redundant):", r.name, dropRedundant ? "" : "(skipped, pass --drop-redundant)");
      if (apply && dropRedundant) await coll.dropIndex(r.name);
    }
  }
  await mongoose.disconnect();
}

module.exports = { planIndexes };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
