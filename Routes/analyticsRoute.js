const Analytics = require("../Models/analyticsModel");
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
    const now = new Date();

    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    const prev7Days = new Date();
    prev7Days.setDate(now.getDate() - 14);

    // 🔥 CURRENT DATA
    const currentSearches = await Analytics.countDocuments({
      type: "search",
      createdAt: { $gte: last7Days },
    });

    const prevSearches = await Analytics.countDocuments({
      type: "search",
      createdAt: { $gte: prev7Days, $lt: last7Days },
    });

    // 🔥 FUNCTION
    const calcGrowth = (current, prev) => {
      if (prev === 0) return 100;
      return (((current - prev) / prev) * 100).toFixed(1);
    };

    res.json({
      totalSearches: currentSearches,
      searchesGrowth: calcGrowth(currentSearches, prevSearches),

      // same logic clicks ke liye bhi lagao
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

router.get("/analytics/recent-searches", async (req, res) => {
  const data = await Analytics.find({ type: "search" })
    .sort({ createdAt: -1 })
    .limit(5);

  res.json(data);
});

module.exports = router;