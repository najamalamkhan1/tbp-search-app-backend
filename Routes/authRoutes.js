const express = require("express");
const router = express.Router();
const Store = require('../Models/store');
const fetch = require("node-fetch");

router.get("/", (req, res) => {
    const { shop } = req.query;
    
    // ✅ hardcode Railway URL — req.protocol pe trust mat karo
    const baseUrl = process.env.HOST;
    const redirectUri = `${baseUrl}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=read_products,write_products&redirect_uri=${redirectUri}`;
    res.redirect(installUrl);
});

router.get("/callback", async (req, res) => {
    const { shop, code } = req.query;
    
    // ✅ Yeh add karo
    if (!shop || !code) {
        return res.status(400).send("Missing shop or code param");
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    try {
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

        if (!accessToken) {
            return res.status(400).send("Failed to get access token: " + JSON.stringify(data));
        }

        await Store.findOneAndUpdate(
            { domain: shop },
            { domain: shop, accessToken },
            { upsert: true }
        );

        await registerWebhooks(shop, accessToken, baseUrl);

        res.send("App Installed Successfully ✅");

    } catch (err) {
        console.error("Callback error:", err);
        res.status(500).send("Error: " + err.message);
    }
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