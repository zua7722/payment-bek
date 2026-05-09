const Router = require("express");
const router = new Router();
const userRouter = require("./userRouter");
const orderRouter = require("./orderRouter");

router.use("/user", userRouter);
router.use("/order", orderRouter);

module.exports = router;
