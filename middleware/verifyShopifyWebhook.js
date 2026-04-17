const crypto = require("crypto");

const verifyShopifyWebhook = (req, res, next) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];

  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(req.body, "utf8") // ✅ IMPORTANT
    .digest("base64");

  if (hash !== hmac) {
    console.log("❌ HMAC FAILED");
    return res.status(401).send("Webhook verification failed");
  }

  console.log("✅ HMAC VERIFIED");
  next();
};

module.exports = verifyShopifyWebhook;