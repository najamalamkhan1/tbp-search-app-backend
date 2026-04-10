const express = require ("express");
const cors = require ("cors");
const productsRoute = require ("./Routes/products");
const searchRoute = require("./Routes/search");
const storesRoute = require('./Routes/storeRoute')
const mongoose = require('mongoose')
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URL)
  .then(async () => {
    console.log("MongoDB Connected ✅");

    const stores = await Store.find();
    console.log("DB STORES:", stores);
  })
  .catch(err => console.log(err));
// routes

app.use("/api", searchRoute);
app.use("/api/store", storesRoute);
// app.use("/api/products", productsRoute);


app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});