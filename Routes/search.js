const express = require("express");
const router = express.Router();
const Store = require('../Models/store')
const Analytics = require("../Models/analyticsModel");

const SHOPIFY_URL = `${process.env.SHOPIFY_STORE_URL}/api/graphql.json`;

// POST /api/stores/add

router.post("/api/stores/add", async (req, res) => {
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

router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (q) {
      await Analytics.create({
        type: "search",
        query: q,
      });
    }

    if (!q || !q.trim()) {
      return res.json({ products: [] });
    }

    const stores = await Store.find();
    console.log("STORES FROM DB:", stores);

    const promises = stores.map(async (store) => {
      try {
        const response = await fetch(
          `https://${store.domain.replace(/\/$/, "")}/admin/api/2024-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": store.accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `
  {
    products(first: 10, sortKey: CREATED_AT, reverse: true, query: "${q}") {
      edges {
        node {
          id
          title
          handle
          createdAt
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
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

        const data = await response.json();

        console.log("STORE:", store.domain);
        console.log("SHOPIFY RESPONSE:", JSON.stringify(data, null, 2));

        return data?.data?.products?.edges?.map((item) => ({
          id: item.node.id,
          title: item.node.title,
          handle: item.node.handle,
          createdAt: item.node.createdAt,

          // ✅ SAFE IMAGE
          image: item.node.images?.edges?.[0]?.node?.url || "",

          // ✅ CORRECT PRICE
          price: item.node.variants?.edges?.[0]?.node?.price?.amount || "0",

          store: store.domain,
        })) || [];

      } catch (err) {
        console.log("ERROR:", store.domain);
        return [];
      }
    });

    const results = await Promise.all(promises);
    const finalProducts = results.flat();
    if (finalProducts.length === 0) {
      await Analytics.create({
        type: "no_result",
        query: q,
      });
    }

    const sorted = results
      .flat()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ products: sorted });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/trending", async (req, res) => {
  try {
    const stores = await Store.find();

    const promises = stores.map(async (store) => {
      try {
        const cleanDomain = store.domain.replace(/\/$/, "");

        const response = await fetch(
          `https://${cleanDomain}/admin/api/2024-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": store.accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `
              {
                products(first: 5, sortKey: CREATED_AT, reverse: true) {
                  edges {
                    node {
                      id
                      title
                      handle
                      images(first: 1) {
                        edges {
                          node {
                            url
                          }
                        }
                      }
                      variants(first: 1) {
                        edges {
                          node {
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

        const data = await response.json();

        return (
          data?.data?.products?.edges?.map((item) => {
            const node = item.node;

            return {
              id: node.id,
              title: node.title,
              handle: node.handle,

              image: node.images?.edges?.[0]?.node?.url || "",
              price: node.variants?.edges?.[0]?.node?.price || "0",

              store: cleanDomain,
            };
          }) || []
        );
      } catch (err) {
        console.log("TRENDING ERROR:", store.domain);
        return [];
      }
    });

    const results = await Promise.all(promises);
    res.json(results.flat());

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;