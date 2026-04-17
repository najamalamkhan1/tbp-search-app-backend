const crypto = require("crypto");

const verifyShopifyWebhook = (req, res, next) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];

  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body)) // ✅ req.body must be Buffer
    .digest("base64");

  if (hash !== hmac) {
    return res.status(401).send("Webhook verification failed");
  }

  next();
  console.log("TYPE:", typeof req.body);
  console.log("IS BUFFER:", Buffer.isBuffer(req.body));
};

module.exports = verifyShopifyWebhook;