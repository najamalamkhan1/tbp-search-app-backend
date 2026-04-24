const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const Store = require('../Models/store')
const Analytics = require("../Models/analyticsModel");

const SHOPIFY_URL = `${process.env.SHOPIFY_STORE_URL}/api/graphql.json`;

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

router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.json({ products: [] });
    }

    const searchQuery = q.trim();

    const stores = await Store.find();

    const results = await Promise.all(
      stores.map(async (store) => {
        try {
          const cleanDomain = store.domain.trim();

          console.log("🔍 STORE:", cleanDomain);

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
                  products(first: 10, query: "title:*${searchQuery}*") {
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

          // ✅ ONLY ONE read
          const data = await response.json();

          console.log("📦 RAW RESPONSE:", JSON.stringify(data, null, 2));

          if (!data?.data?.products?.edges) {
            console.log("⚠️ No products found for:", cleanDomain);
            return [];
          }

          return data.data.products.edges.map((item) => ({
            id: item.node.id,
            title: item.node.title,
            handle: item.node.handle || "",
            createdAt: item.node.createdAt,
            image: item.node.images?.edges?.[0]?.node?.url || "",
            price: item.node.variants?.edges?.[0]?.node?.price || "0",
            store: cleanDomain,
          }));

        } catch (err) {
          console.error("❌ STORE ERROR:", store.domain, err.message);
          return [];
        }
      })
    );

    const finalProducts = results.flat();

    console.log("✅ FINAL PRODUCTS:", finalProducts.length);

    res.json({ products: finalProducts });

  } catch (err) {
    console.error("🔥 SERVER ERROR:", err);
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