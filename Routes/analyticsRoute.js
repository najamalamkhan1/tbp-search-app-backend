const Analytics = require("../Models/analytics");
const router = require("./search");

router.post("/analytics", async (req, res) => {
  try {
    const { type, query, productId, store } = req.body;

    const newData = await Analytics.create({
      type,
      query,
      productId,
      store,
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/analytics/stats", async (req, res) => {
  try {
    const totalSearches = await Analytics.countDocuments({ type: "search" });
    const totalClicks = await Analytics.countDocuments({ type: "click" });
    const noResults = await Analytics.countDocuments({ type: "no_result" });

    res.json({
      totalSearches,
      totalClicks,
      noResults,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/analytics/top-searches", async (req, res) => {
  const data = await Analytics.aggregate([
    { $match: { type: "search" } },
    { $group: { _id: "$query", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  res.json(data);
});

router.get("/analytics/top-products", async (req, res) => {
  const data = await Analytics.aggregate([
    { $match: { type: "click" } },
    { $group: { _id: "$productId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  res.json(data);
});

module.exports = router;