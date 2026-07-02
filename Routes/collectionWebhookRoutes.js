const express = require("express");
const router = express.Router();

const Collection =
  require("../Models/collectionModel");
const Product =
  require("../Models/productModel");
const Store =
  require("../Models/store");
const fetch =
  require("node-fetch");

const searchRoute =
  require("./search");

const verifyShopifyWebhook =
  require("../middleware/verifyShopifyWebhook");

const toShopDomain = (shop) =>
  String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

const collectionIdsFor = (data = {}) => {
  const plainId = String(data.id || "").trim();
  const gid = String(data.admin_graphql_api_id || (plainId ? `gid://shopify/Collection/${plainId}` : "")).trim();
  return [...new Set([plainId, gid].filter(Boolean))];
};

const productIdsFor = (gid) => {
  const plainId = String(gid || "").replace(/^gid:\/\/shopify\/Product\//, "").trim();
  return [...new Set([gid, plainId].filter(Boolean))];
};

async function fetchCollectionProductIds({ shop, accessToken, collectionGid }) {
  const ids = new Set();
  let cursor = null;
  let hasNextPage = true;

  const query = `
query CollectionProducts($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on Collection {
      products(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
          }
        }
      }
    }
  }
}`;

  while (hasNextPage) {
    const response = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { id: collectionGid, cursor }
      })
    });

    if (!response.ok) {
      throw new Error(`Shopify collection products failed: ${response.status}`);
    }

    const data = await response.json();
    if (data?.errors) {
      throw new Error(data.errors?.[0]?.message || "Shopify collection products error");
    }

    const products = data?.data?.node?.products;
    (products?.edges || []).forEach(edge => {
      if (edge?.node?.id) ids.add(String(edge.node.id));
    });

    hasNextPage = Boolean(products?.pageInfo?.hasNextPage);
    cursor = products?.pageInfo?.endCursor || null;
    if (!cursor) hasNextPage = false;
  }

  return [...ids];
}

async function refreshCollectionMembership({ shop, collectionData }) {
  const cleanShop = toShopDomain(shop);
  const collectionIds = collectionIdsFor(collectionData);
  if (!cleanShop || !collectionIds.length) return;

  if (!collectionData.published_at) {
    await Product.updateMany(
      { store: cleanShop, collections: { $in: collectionIds } },
      { $pull: { collections: { $in: collectionIds } } }
    );
    searchRoute.clearSearchCache?.(cleanShop);
    searchRoute.clearTrendingCache?.(cleanShop);
    return;
  }

  const store = await Store.findOne({ domain: cleanShop }).lean();
  if (!store?.accessToken) {
    console.warn("COLLECTION MEMBERSHIP SYNC SKIPPED: store token missing", cleanShop);
    return;
  }

  const collectionGid = collectionIds.find(id => id.startsWith("gid://")) || `gid://shopify/Collection/${collectionIds[0]}`;
  const currentProductIds = await fetchCollectionProductIds({
    shop: cleanShop,
    accessToken: store.accessToken,
    collectionGid
  });
  const productIds = [...new Set(currentProductIds.flatMap(productIdsFor))];

  await Product.updateMany(
    { store: cleanShop, collections: { $in: collectionIds } },
    { $pull: { collections: { $in: collectionIds } } }
  );

  if (productIds.length) {
    await Product.updateMany(
      { store: cleanShop, productId: { $in: productIds } },
      { $addToSet: { collections: { $each: collectionIds } } }
    );
  }

  searchRoute.clearSearchCache?.(cleanShop);
  searchRoute.clearTrendingCache?.(cleanShop);

  console.log(
    "COLLECTION MEMBERSHIP SYNCED:",
    collectionData.title || collectionData.id,
    productIds.length
  );
}

function queueCollectionMembershipRefresh({ shop, collectionData }) {
  setImmediate(() => {
    refreshCollectionMembership({ shop, collectionData }).catch(err => {
      console.error("COLLECTION MEMBERSHIP SYNC ERROR:", err.message);
    });
  });
}

// =====================================
// CREATE COLLECTION
// =====================================
router.post(
  "/collections/create",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndUpdate(

        {
          collectionId: String(data.id),
          store: shop
        },

        {
          store: shop,

          collectionId:
            String(data.id),

          title:
            data.title || "",

          handle:
            data.handle || "",

          image:
            data.image?.src || "",

          description:
            String(
              data.body_html || ""
            )
              .replace(/<[^>]*>/g, "")
              .slice(0, 2000),

          productsCount:
            Number(
              data.products_count || 0
            ),

          shopifyCreatedAt:
            data.created_at
              ? new Date(data.created_at)
              : null,

          shopifyPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : null,

          firstPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : (
                data.created_at
                  ? new Date(data.created_at)
                  : null
              ),

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
            ${data.body_html || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      if (!data.published_at) {
        await Collection.deleteOne({
          collectionId: String(data.id),
          store: shop
        });
      }

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);
      queueCollectionMembershipRefresh({ shop, collectionData: data });

      console.log(
        "✅ COLLECTION CREATED:",
        data.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION CREATE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

// =====================================
// UPDATE COLLECTION
// =====================================
router.post(
  "/collections/update",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndUpdate(

        {
          collectionId: String(data.id),
          store: shop
        },

        {
          store: shop,

          collectionId:
            String(data.id),

          title:
            data.title || "",

          handle:
            data.handle || "",

          image:
            data.image?.src || "",

          description:
            String(
              data.body_html || ""
            )
              .replace(/<[^>]*>/g, "")
              .slice(0, 2000),

          productsCount:
            Number(
              data.products_count || 0
            ),

          shopifyCreatedAt:
            data.created_at
              ? new Date(data.created_at)
              : null,

          shopifyPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : null,

          firstPublishedAt:
            data.published_at
              ? new Date(data.published_at)
              : (
                data.created_at
                  ? new Date(data.created_at)
                  : null
              ),

          searchableText: `
            ${data.title || ""}
            ${data.handle || ""}
            ${data.body_html || ""}
          `.toLowerCase()

        },

        {
          upsert: true,
          new: true
        }
      );

      if (!data.published_at) {
        await Collection.deleteOne({
          collectionId: String(data.id),
          store: shop
        });
      }

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);
      queueCollectionMembershipRefresh({ shop, collectionData: data });

      console.log(
        "♻️ COLLECTION UPDATED:",
        data.title
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION UPDATE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

// =====================================
// DELETE COLLECTION
// =====================================
router.post(
  "/collections/delete",
  verifyShopifyWebhook,
  async (req, res) => {

    try {
      res.status(200).send("OK");

      const shop =
        req.headers[
          "x-shopify-shop-domain"
        ]
          ?.trim()
          ?.toLowerCase();

      const data =
        JSON.parse(req.body.toString());

      await Collection.findOneAndDelete({

        collectionId:
          String(data.id),

        store: shop
      });
      await Product.updateMany(
        {
          store: shop,
          collections: { $in: collectionIdsFor(data) }
        },
        {
          $pull: { collections: { $in: collectionIdsFor(data) } }
        }
      );

      searchRoute.clearSearchCache?.(shop);
      searchRoute.clearTrendingCache?.(shop);

      console.log(
        "🗑 COLLECTION DELETED:",
        data.id
      );

      if (!res.headersSent) {
        res.status(200).send("OK");
      }

    } catch (err) {

      console.log(
        "COLLECTION DELETE ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).send("ERROR");
      }
    }
  }
);

module.exports = router;
