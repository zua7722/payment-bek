require('dotenv').config();
const express = require('express');
const sequelize = require("./db");
const cors = require("cors");
const model = require("./models/model");
const errorHeandler = require("./middleware/ErrorHeadlingMiddleware");
const router = require("./routes/index");
const path = require("path");

const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "static")));
app.use("/api/v1/", router);

app.use(errorHeandler);

app.get("/", (req, res) => {
  res.send("Dashboard is running!");
});

const start = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (e) {
    console.log(e);
  }
};

start()