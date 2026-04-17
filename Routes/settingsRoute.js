const express = require("express");
const router = express.Router();
const Settings = require('../Models/settingsModel')
const Product = require("../Models/productModel");
const fetch = require("node-fetch");

router.get('/settings', async (req, res) => {
    const { shop } = req.query;

    let settings = await Settings.findOne({ shop });

    if (!settings) {
        settings = await Settings.create({ shop });
    }

    res.json(settings);
})

router.put('/settings', async (req, res) => {
    const { shop, ...updates } = req.body;

    const settings = await Settings.findOneAndUpdate(
        { shop },
        { $set: updates },
        { new: true, upsert: true }
    );

    res.json(settings);
})

router.put('/settings/filters/order', async (req, res) => {
    const { shop, active } = req.body;

    const settings = await Settings.findOneAndUpdate(
        { shop },
        { "filters.active": active },
        { new: true }
    );

    res.json(settings);
});

router.post('/settings/reset', async (req, res) => {
    const { shop } = req.body;

    await Settings.findOneAndDelete({ shop });

    const newSettings = await Settings.create({ shop });

    res.json(newSettings);
})

module.exports = router;