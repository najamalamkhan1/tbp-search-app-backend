function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTag(value) {
  return normalizeSearchText(value).replace(/\b(formals)\b/g, "formal");
}

function resolveVendor(query, vendors = [], ignoredWords = new Set()) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const meaningfulTokens = queryTokens.filter(token => !ignoredWords.has(token));
  if (!meaningfulTokens.length) return null;

  const candidates = vendors
    .filter(Boolean)
    .map(vendor => {
      const normalizedVendor = normalizeSearchText(vendor);
      const vendorTokens = normalizedVendor.split(" ").filter(Boolean);
      let score = 0;

      if (normalizedVendor === normalizedQuery) score = 100000;
      else if (normalizedVendor.startsWith(normalizedQuery)) score = 80000;
      else if (normalizedQuery.startsWith(normalizedVendor + " ")) score = 70000;
      else {
        let consecutivePrefixTokens = 0;
        for (let index = 0; index < meaningfulTokens.length; index += 1) {
          const queryToken = meaningfulTokens[index];
          const vendorToken = vendorTokens[index];
          if (!vendorToken || !vendorToken.startsWith(queryToken)) break;
          consecutivePrefixTokens += 1;
        }
        if (consecutivePrefixTokens) {
          score = 50000 + (consecutivePrefixTokens * 10000);
          if (consecutivePrefixTokens === meaningfulTokens.length) score += 10000;
        }
      }

      return { vendor, normalizedVendor, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.normalizedVendor.length - b.normalizedVendor.length);

  return candidates[0]?.vendor || null;
}

function productIsAvailable(product = {}) {
  if (product.availableForSale === true) return true;
  if (Number(product.stock || 0) > 0) return true;
  return Array.isArray(product.variantsInventory) && product.variantsInventory.some(variant =>
    variant?.availableForSale === true ||
    Number(variant?.quantity || 0) > 0 ||
    String(variant?.inventoryPolicy || "").toUpperCase() === "CONTINUE"
  );
}

function compareAvailableLatest(a, b) {
  const availabilityDiff = Number(productIsAvailable(b)) - Number(productIsAvailable(a));
  if (availabilityDiff) return availabilityDiff;
  const timeDiff = Number(b.latestTime || 0) - Number(a.latestTime || 0);
  if (timeDiff) return timeDiff;
  return Number(b.score || 0) - Number(a.score || 0);
}

module.exports = {
  compareAvailableLatest,
  normalizeSearchText,
  normalizeTag,
  productIsAvailable,
  resolveVendor,
};
