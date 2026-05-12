const crypto = require("crypto");

const verifyShopifyWebhook = (
  req,
  res,
  next
) => {

  try {

    const hmac =
      req.headers[
        "x-shopify-hmac-sha256"
      ];

    // ✅ DEBUG
    console.log(
      "IS BUFFER:",
      Buffer.isBuffer(req.body)
    );

    if (!hmac) {

      console.log(
        "❌ Missing HMAC Header"
      );

      return res
        .status(401)
        .send("Missing HMAC");
    }

    // ✅ USE SHOPIFY APP SECRET
    const generatedHash = crypto
      .createHmac(
        "sha256",
        process.env.SHOPIFY_API_SECRET
      )
      .update(req.body)
      .digest("base64");

    // ✅ DEBUG
    console.log(
      "SHOPIFY HMAC:",
      hmac
    );

    console.log(
      "GENERATED HMAC:",
      generatedHash
    );

    // ✅ SAFE COMPARE
    const isValid =
      crypto.timingSafeEqual(
        Buffer.from(generatedHash),
        Buffer.from(hmac)
      );

    if (!isValid) {

      console.log(
        "❌ HMAC FAILED"
      );

      return res
        .status(401)
        .send("Webhook verification failed");
    }

    console.log(
      "✅ HMAC VERIFIED"
    );

    next();

  } catch (err) {

    console.log(
      "WEBHOOK VERIFY ERROR:",
      err
    );

    res.status(500).send("Error");
  }
};

module.exports = verifyShopifyWebhook;