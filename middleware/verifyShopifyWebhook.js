const crypto = require("crypto");

const verifyShopifyWebhook = (req, res, next) => {
  try {
    const hmac = req.headers["x-shopify-hmac-sha256"];

    if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
      return res.status(500).send("Secret missing ❌");
    }

    const hash = crypto
      .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(req.body) // ✅ IMPORTANT (no stringify, no 'body')
      .digest("base64");

    if (hash !== hmac) {
      return res.status(401).send("Webhook verification failed ❌");
    }

    next();

  } catch (err) {
    console.error(err);
    res.status(500).send("Webhook error");
  }
};

module.exports = verifyShopifyWebhook;