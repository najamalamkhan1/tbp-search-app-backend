const express = require ("express");
const cors = require ("cors");
const dotenv = require ("dotenv");
const productsRoute = require ("./Routes/products");
const searchRoute = require("./Routes/search");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// routes

app.use("/api/search", searchRoute);
app.use("/api/products", productsRoute);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});