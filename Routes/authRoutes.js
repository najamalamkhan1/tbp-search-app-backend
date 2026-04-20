const express = require("express");
const router = express.Router();
const Store = require('../Models/store');
const fetch = require("node-fetch");

router.get("/", (req, res) => {
    const { shop } = req.query;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=read_products,write_products&redirect_uri=${redirectUri}`;
    res.redirect(installUrl);
});

router.get("/callback", async (req, res) => {
    const { shop, code } = req.query;
    const baseUrl = `${req.protocol}://${req.get("host")}`;

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

    // ✅ domain field use karo
    await Store.findOneAndUpdate(
        { domain: shop },
        { domain: shop, accessToken },
        { upsert: true }
    );

    await registerWebhooks(shop, accessToken, baseUrl);

    res.send("App Installed Successfully ✅");
});

const registerWebhooks = async (shop, accessToken, baseUrl) => {
    const topics = [
        "products/create",
        "products/update",
        "products/delete"
    ];

    for (const topic of topics) {
        await fetch(`https://${shop}/admin/api/2023-10/webhooks.json`, {
            method: "POST",
            headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                webhook: {
                    topic,
                    address: `${baseUrl}/webhooks/${topic}`, // ✅ clean
                    format: "json",
                },
            }),
        });
        console.log("✅ Webhook registered:", topic);
    }
};

module.exports = router;