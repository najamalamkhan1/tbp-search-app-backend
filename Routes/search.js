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

// router.get("/", async (req, res) => {
//   const searchQuery = req.query.q || "";

//   try {
//     const response = await fetch(SHOPIFY_URL, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_TOKEN,
//       },
//       body: JSON.stringify({
//         query: `
// {
//   products(
//     first: 10,
//     query: "title:*${searchQuery}* OR tag:*${searchQuery}* OR vendor:*${searchQuery} OR body:*${searchQuery}*",
//     sortKey: CREATED_AT,
//     reverse: true
//   ) {
//     edges {
//       node {
//         id
//         title
//         handle
//         createdAt
//         images(first: 1) {
//           edges {
//             node {
//               url
//             }
//           }
//         }
//         variants(first: 1) {
//           edges {
//             node {
//               price {
//                 amount
//               }
//             }
//           }
//         }
//       }
//     }
//   }
// }
// `,
//       }),
//     });

//     const data = await response.json();

//     const products = data.data.products.edges.map((item) => ({
//       id: item.node.id,
//       title: item.node.title,
//       image: item.node.images.edges?.[0]?.node?.url || "",
//       price: item.node.variants.edges?.[0]?.node?.price?.amount || "0",
//     }));

//     res.json(products);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Search failed" });
//   }
// });

// Trending now route
// router.get("/api/search", async (req, res) => {
//   const { q } = req.query;

//   const stores = await Store.find();

//   let results = [];

//   for (let store of stores) {
//     try {
//       const response = await fetch(
//         `https://${store.domain}/admin/api/2024-01/graphql.json`,
//         {
//           method: "POST",
//           headers: {
//             "X-Shopify-Access-Token": store.accessToken,
//             "Content-Type": "application/json"
//           },
//           body: JSON.stringify({
//             query: `
//               {
//                 products(first: 5, query: "title:${q}") {
//                   edges {
//                     node {
//                       id
//                       title
//                     }
//                   }
//                 }
//               }
//             `
//           })
//         }
//       );

//       const data = await response.json();

//       const products = data.data.products.edges.map(e => ({
//         ...e.node,
//         store: store.domain
//       }));

//       results.push(...products);

//     } catch (err) {
//       console.log("Error with store:", store.domain);
//     }
//   }

//   res.json({ products: results });
// });

router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.json({ products: [] });
    }

    const stores = await Store.find();

    const promises = stores.map(async (store) => {
      try {
        const response = await fetch(
          `https://${store.domain}/admin/api/2024-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": store.accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `
              {
                products(first: 5, query: "title:*${q}* OR tag:*${q}*") {
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
                            price {
                              amount
                            }
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

        return data?.data?.products?.edges?.map((item) => ({
          id: item.node.id,
          title: item.node.title,
          handle: item.node.handle,
          image: item.node.images?.edges?.[0]?.node?.url || "",
          price: item.node.variants?.edges?.[0]?.node?.price?.amount || "0",
          store: store.domain,
        })) || [];

      } catch (err) {
        console.log("SEARCH ERROR:", store.domain);
        return [];
      }
    });

    const results = await Promise.all(promises);
    res.json({ products: results.flat() });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/trending", async (req, res) => {
  try {
    const stores = await Store.find();

    const promises = stores.map(async (store) => {
      try {
        const response = await fetch(
          `https://${store.domain}/admin/api/2024-01/graphql.json`,
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
                            price {
                              amount
                            }
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

        return data?.data?.products?.edges?.map((item) => ({
          id: item.node.id,
          title: item.node.title,
          handle: item.node.handle,
          image: item.node.images?.edges?.[0]?.node?.url || "",
          price: item.node.variants?.edges?.[0]?.node?.price?.amount || "0",
          store: store.domain,
        })) || [];

      } catch (err) {
        console.log("ERROR TRENDING:", store.domain);
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