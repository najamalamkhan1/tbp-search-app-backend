const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");


router.get("/", (req, res) => {
    const { shop } = req.query;

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const redirectUri = `${baseUrl}/auth/callback`;

    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=read_products,write_products&redirect_uri=${redirectUri}`;

    res.redirect(installUrl);
});

router.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;

  // 🔥 Access token exchange
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });

  const data = await response.json();

  const accessToken = data.access_token;

  // ✅ Store save karo
  await Store.findOneAndUpdate(
    { shop },
    { shop, accessToken },
    { upsert: true }
  );

  // 🔥 Webhook auto register
  await registerWebhooks(shop, accessToken);

  res.send("App Installed Successfully ✅");
});

const registerWebhooks = async (shop, accessToken) => {
  const webhookUrl = `${baseUrl}/webhooks/products/update`;

  await fetch(`https://${shop}/admin/api/2023-10/webhooks.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhook: {
        topic: "products/update",
        address: webhookUrl,
        format: "json",
      },
    }),
  });
};