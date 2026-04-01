const express = require("express");
const router = express.Router();

const SHOPIFY_URL = "https://ttbp-lam-test.myshopify.com/api/2023-10/graphql.json";

router.get("/", async (req, res) => {
  const searchQuery = req.query.q || "";

  try {
    const response = await fetch(SHOPIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_TOKEN,
      },
      body: JSON.stringify({
        query: `
        {
          products(first: 10, query: "${searchQuery}") {
            edges {
              node {
                id
                title
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
    });

    const data = await response.json();

    if (data.errors) {
      return res.status(400).json(data.errors);
    }

    const products = data.data.products.edges.map((item) => ({
  id: item.node.id,
  title: item.node.title,
  handle: item.node.handle,
  image: item.node.images.edges[0]?.node.url,
  price: item.node.variants.edges[0]?.node.price.amount,
  createdAt: item.node.createdAt,
}));

// 🔥 SORT HERE
const sortedProducts = products.sort((a, b) => {
  return new Date(b.createdAt) - new Date(a.createdAt);
});

// ✅ SEND SORTED DATA
res.json(sortedProducts);
  } catch (error) {
    console.error("SEARCH ERROR:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;