const Router = require("express");
const router = new Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/middleware");

router.post("/", userController.createUser);

router.get("/", authMiddleware, userController.getAllUsers);

router.get("/check", authMiddleware, userController.checkAuth);

router.get("/:id", authMiddleware, userController.getUserById);

router.put("/:id", authMiddleware, userController.updateUser);

router.delete("/:id", authMiddleware, userController.deleteUser);

router.post("/login", userController.login);


module.exports = router;