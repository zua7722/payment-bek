const { User } = require("../models/model");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const uuid = require("uuid");
const ApiError = require("../error/ApiError");

const generateJwt = (id, email, role) => {
  const payload = { id, email, role };
  return jwt.sign(payload, process.env.SECRET_KEY, { expiresIn: "24h" });
};

class UserController {
  // Создание пользователя (регистрация)
  async createUser(req, res, next) {
    try {
      const { email, password, role } = req.body;
      // const currentUser = req.user;

      // // Проверка прав для создания админа
      // if (role === "ADMIN" && (!currentUser || currentUser.role !== "ADMIN")) {
      //   return next(ApiError.forbidden("Нет прав для создания администратора"));
      // }

      // Проверка существующего пользователя
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return next(ApiError.badRequest("Пользователь с таким email уже существует"));
      }

      // Хэширование пароля
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await User.create({
        email,
        password: hashedPassword,
        role: role || "USER",
      });

      const { password: _, ...userWithoutPassword } = user.toJSON();

      return res.json(userWithoutPassword);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  async getAllUsers(req, res, next) {
    try {
      const user = req.user;

      if (user.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет доступа"));
      }

      const users = await User.findAll({
        attributes: { exclude: ["password"] },
        order: [["createdAt", "DESC"]],
      });

      return res.json(users);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  // Получение пользователя по ID
  async getUserById(req, res, next) {
    try {
      const { id } = req.params;
      const currentUser = req.user;

      const user = await User.findByPk(id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) {
        return next(ApiError.badRequest("Пользователь не найден"));
      }

      // Проверка прав: админ или сам пользователь
      if (currentUser.role !== "ADMIN" && currentUser.id !== parseInt(id)) {
        return next(ApiError.forbidden("Нет доступа"));
      }

      return res.json(user);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  // Обновление пользователя
  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const { name, email, password, role } = req.body;
      const currentUser = req.user;

      const user = await User.findByPk(id);

      if (!user) {
        return next(ApiError.badRequest("Пользователь не найден"));
      }

      // Проверка прав
      if (currentUser.role !== "ADMIN" && currentUser.id !== parseInt(id)) {
        return next(ApiError.forbidden("Нет доступа"));
      }

      // Только админ может менять роль
      if (role && currentUser.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет прав для изменения роли"));
      }

      const updateData = { name, email };
      if (role && currentUser.role === "ADMIN") {
        updateData.role = role;
      }
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      await user.update(updateData);

      const { password: _, ...userWithoutPassword } = user.toJSON();
      return res.json(userWithoutPassword);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  // Удаление пользователя (только для админа)
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      const currentUser = req.user;

      if (currentUser.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет доступа"));
      }

      if (currentUser.id === parseInt(id)) {
        return next(ApiError.badRequest("Нельзя удалить самого себя"));
      }

      const user = await User.findByPk(id);

      if (!user) {
        return next(ApiError.badRequest("Пользователь не найден"));
      }

      await user.destroy();

      return res.json({ message: "Пользователь успешно удален" });
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  // Логин
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ where: { email } });

      if (!user) {
        return next(ApiError.badRequest("Пользователь не найден"));
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return next(ApiError.badRequest("Неверный пароль"));
      }

      const token = generateJwt(user.id, user.email, user.role);

      const { password: _, ...userWithoutPassword } = user.toJSON();

      return res.json({ user: userWithoutPassword, token });
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  // Проверка токена
  async checkAuth(req, res, next) {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) {
        return next(ApiError.unauthorized("Пользователь не найден"));
      }

      return res.json(user);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }
}

module.exports = new UserController();