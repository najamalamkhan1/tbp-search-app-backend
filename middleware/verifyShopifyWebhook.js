const crypto = require("crypto");

const verifyShopifyWebhook = (req, res, next) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  if (hash !== hmac) {
    return res.status(401).send("Webhook verification failed");
  }

  console.log("👉 HMAC HEADER:", hmac);
  console.log("👉 GENERATED HASH:", hash);

  next();
};

module.exports = verifyShopifyWebhook;