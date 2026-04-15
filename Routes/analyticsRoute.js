const Analytics = require("../Models/analyticsModel");
const router = require("./search");

router.post("/analytics", async (req, res) => {
  try {
    const { type, query, productId, store } = req.body;

    const newData = await Analytics.create({
      type,
      query,
      productId,
      store: store || null,
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
    { $limit: 10 },
  ]);

  res.json(data);
});

router.get("/analytics/top-products", async (req, res) => {
  try {
    const { store } = req.query;

    const match = {
      type: "click",
    };

    if (store) {
      match.store = store; // 🔥 FILTER
    }

    const data = await Analytics.aggregate([
      { $match: match },

      {
        $group: {
          _id: "$productId",
          count: { $sum: 1 },
          title: { $first: "$title" },
          image: { $first: "$image" },
        },
      },

      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/analytics/recent-searches", async (req, res) => {
  const data = await Analytics.find({ type: "search" })
    .sort({ createdAt: -1 })
    .limit(5);

  res.json(data);
});

search-trends


router.get("/analytics/stats/all", async (req, res) => {
  try {
    const stores = await Analytics.aggregate([
      {
        $group: {
          _id: "$store",
          totalSearches: {
            $sum: { $cond: [{ $eq: ["$type", "search"] }, 1, 0] },
          },
          totalClicks: {
            $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] },
          },
          noResults: {
            $sum: { $cond: [{ $eq: ["$type", "no_result"] }, 1, 0] },
          },
        },
      },
    ]);

    // 🔥 total (all stores)
    const totals = stores.reduce(
      (acc, s) => ({
        totalSearches: acc.totalSearches + s.totalSearches,
        totalClicks: acc.totalClicks + s.totalClicks,
        noResults: acc.noResults + s.noResults,
      }),
      { totalSearches: 0, totalClicks: 0, noResults: 0 }
    );

    res.json({
      totals,
      stores,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/analytics/stats/all", async (req, res) => {
  try {
    // 🔥 TOTAL SEARCHES
    const totalSearches = await Analytics.countDocuments({
      type: "search",
      store: { $exists: true }
    });

    // 🔥 TOTAL CLICKS
    const totalClicks = await Analytics.countDocuments({
      type: "click",
      store: { $exists: true }
    });

    // 🔥 STORE WISE
    const stores = await Analytics.aggregate([
      {
        $match: {
          store: { $exists: true }
        }
      },
      {
        $group: {
          _id: "$store",
          totalSearches: {
            $sum: { $cond: [{ $eq: ["$type", "search"] }, 1, 0] }
          },
          totalClicks: {
            $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] }
          }
        }
      }
    ]);

    // 🔥 ADD CONVERSION RATE
    const storesWithConversion = stores.map(s => ({
      ...s,
      conversionRate:
        s.totalSearches === 0
          ? 0
          : ((s.totalClicks / s.totalSearches) * 100).toFixed(1)
    }));

    res.json({
      totals: {
        totalSearches,
        totalClicks,
        conversionRate:
          totalSearches === 0
            ? 0
            : ((totalClicks / totalSearches) * 100).toFixed(1)
      },
      stores: storesWithConversion
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/analytics/clear", async (req, res) => {
  try {
    await Analytics.deleteMany({});
    res.json({ message: "All analytics deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;