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

// MongoDB Connection
mongoose.connect(
    process.env.MONGO_DB_URI
)
// database connect
const db = mongoose.connection;
db.on('error',(error)=>{
    console.log("Error Occured",error);
});
db.once('connected',()=>{
    console.log('MongoDB connected');
})
// routes

app.use("/api/search", searchRoute);
app.use("/api/store", storesRoute);
// app.use("/api/products", productsRoute);


app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});