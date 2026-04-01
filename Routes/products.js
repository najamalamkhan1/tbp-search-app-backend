const express = require("express");
const router = express.Router();

const SHOPIFY_URL = `${process.env.SHOPIFY_STORE_URL}/api/graphql.json`;

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
  products(
    first: 10,
    query: "title:*${searchQuery}* OR tag:*${searchQuery}* OR body:*${searchQuery}*",
    sortKey: CREATED_AT,
    reverse: true
  ) {
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

    const products = data.data.products.edges.map((item) => ({
      id: item.node.id,
      title: item.node.title,
      image: item.node.images.edges?.[0]?.node?.url || "",
      price: item.node.variants.edges?.[0]?.node?.price?.amount || "0",
    }));

    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;