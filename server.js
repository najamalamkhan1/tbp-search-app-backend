const express = require("express");
const cors = require("cors");
const mongoose = require('mongoose')
require("dotenv").config();

const app = express();

app.use(cors());
app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

// MongoDB Connection
mongoose.connect(
    process.env.MONGO_DB_URI
)
// database connect
const db = mongoose.connection;
db.on('error', (error) => {
    console.log("Error Occured", error);
});
db.once('connected', () => {
    console.log('MongoDB connected');
})

// Routes files import
const productsRoute = require("./Routes/productsRoute");
const searchRoute = require("./Routes/search");
const storesRoute = require('./Routes/storeRoute')
const analyticsRoute = require('./Routes/analyticsRoute')
const settingsRoute = require('./Routes/settingsRoute')

// routes
app.use("/api", searchRoute);
app.use("/api", storesRoute);
app.use('/api', analyticsRoute)
app.use('/api', settingsRoute)
app.use("/api/", productsRoute);
app.use("/api", require("./Routes/webhookRoutes"));


app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});