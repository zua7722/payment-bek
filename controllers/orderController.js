const uuid = require("uuid");
const ApiError = require("../error/ApiError");
const { Op } = require("sequelize");
const { Order } = require("../models/model");

const yookassaService = require("../services/yookassa.service");

class OrderController {
  // Создание заказа с оплатой
  async createOrder(req, res, next) {
    try {
      const { email, phone, price, fio } = req.body;

      const errors = [];
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const amountFloat = parseFloat(price);
      const MIN_AMOUNT = 50.0;

      if (!emailValid) {
        errors.push("Введите корректный e-mail для чека.");
      }
      if (!fio || fio.trim() === "") {
        errors.push("Введите ФИО плательщика.");
      }
      if (!phone || phone.trim() === "") {
        errors.push("Введите номер телефона для связи.");
      }
      if (amountFloat <= 0) {
        errors.push("Сумма должна быть больше 0.");
      }
      if (amountFloat > 0 && amountFloat < MIN_AMOUNT) {
        errors.push(`Минимальная сумма оплаты — ${MIN_AMOUNT} ₽.`);
      }

      if (errors.length > 0) {
        return next(ApiError.badRequest(errors.join(", ")));
      }

      const orderId = uuid.v4().replace(/-/g, "");

      // Создаем платеж в ЮKassa
      const paymentData = await yookassaService.createPayment(
        amountFloat,
        `Заказ №${orderId} (${fio})`,
        {
          orderId: orderId,
          customer_fio: fio,
          customer_phone: phone,
          customer_email: email,
        },
        {
          email: email,
          fio: fio,
          description:
            "Передача неисключительного права использования программы для ЭВМ (облачной телематической системы)",
          vatCode: "1",
        },
      );

      if (!paymentData || !paymentData.confirmation?.confirmation_url) {
        throw new Error("Не удалось создать платеж");
      }

      const order = await Order.create({
        id: orderId,
        email,
        phone,
        price: amountFloat.toString(),
        paid: false,
        fio,
        paymentId: paymentData.id,
        paymentStatus: paymentData.status,
        paymentUrl: paymentData.confirmation.confirmation_url,
        yookassaMetadata: paymentData.metadata,
      });

      return res.json({
        success: true,
        order: {
          id: order.id,
          email: order.email,
          phone: order.phone,
          price: order.price,
          fio: order.fio,
          paid: order.paid,
        },
        paymentUrl: paymentData.confirmation.confirmation_url,
        paymentId: paymentData.id,
      });
    } catch (err) {
      console.error("Error creating order:", err);
      return next(
        ApiError.badRequest(err.message || "Ошибка создания платежа"),
      );
    }
  }

  async getAllOrders(req, res, next) {
    try {
      const user = req.user;

      if (user.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет доступа"));
      }

      const orders = await Order.findAll({
        order: [["createdAt", "DESC"]],
      });

      return res.json(orders);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  async getOrderById(req, res, next) {
    try {
      const { id } = req.params;
      const user = req.user;

      const order = await Order.findByPk(id);

      if (!order) {
        return next(ApiError.badRequest("Заказ не найден"));
      }

      // Проверка прав: админ или владелец заказа
      if (user.role !== "ADMIN" && user.email !== order.email) {
        return next(ApiError.forbidden("Нет доступа к этому заказу"));
      }

      return res.json(order);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  async updateOrder(req, res, next) {
    try {
      const { id } = req.params;
      const { email, phone, price, paid, fio } = req.body;
      const user = req.user;

      if (user.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет доступа"));
      }

      const order = await Order.findByPk(id);

      if (!order) {
        return next(ApiError.badRequest("Заказ не найден"));
      }

      await order.update({
        email,
        phone,
        price,
        paid,
        fio,
      });

      return res.json(order);
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  async deleteOrder(req, res, next) {
    try {
      const { id } = req.params;
      const user = req.user;

      if (user.role !== "ADMIN") {
        return next(ApiError.forbidden("Нет доступа"));
      }

      const order = await Order.findByPk(id);

      if (!order) {
        return next(ApiError.badRequest("Заказ не найден"));
      }

      await order.destroy();

      return res.json({ message: "Заказ успешно удален" });
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }

  async handlePaymentWebhook(req, res, next) {
    try {
      console.log("=== Webhook received ===");
      console.log("Headers:", req.headers);
      console.log("Body:", JSON.stringify(req.body, null, 2));

      const event = req.body;

      const signature = req.headers["yookassa-signature"];
      if (signature) {
        const isValid = yookassaService.validateWebhookSignature(
          event,
          signature,
        );
        if (!isValid && process.env.NODE_ENV === "production") {
          console.error("Invalid webhook signature");
          return res.status(400).json({ error: "Invalid signature" });
        }
      }

      if (
        event.type === "notification" &&
        event.event === "payment.succeeded"
      ) {
        const payment = event.object;
        const paymentId = payment.id;
        const metadata = payment.metadata || {};

        console.log(`Payment succeeded: ${paymentId}`);
        console.log("Metadata:", metadata);

        let order = null;

        if (metadata.orderId) {
          order = await Order.findByPk(metadata.orderId);
        }

        if (!order && paymentId) {
          order = await Order.findOne({ where: { paymentId: paymentId } });
        }

        if (order) {
          if (!order.paid) {
            await order.update({
              paid: true,
              paymentStatus: "succeeded",
              paidAt: new Date(),
              paymentId: paymentId,
            });

            console.log(`✅ Order ${order.id} marked as paid`);
          } else {
            console.log(`Order ${order.id} already paid`);
          }
        } else {
          console.log(`Order not found for payment ${paymentId}`);
        }
      }

      if (event.event === "payment.waiting_for_capture") {
        console.log("Payment waiting for capture:", event.object.id);
      }

      if (event.event === "payment.canceled") {
        console.log("Payment canceled:", event.object.id);
        const paymentId = event.object.id;
        const order = await Order.findOne({ where: { paymentId: paymentId } });
        if (order) {
          await order.update({
            paymentStatus: "canceled",
          });
          console.log(`Order ${order.id} marked as canceled`);
        }
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(200).json({ received: true, error: error.message });
    }
  }

  async checkPaymentStatus(req, res, next) {
    try {
      const { orderId } = req.params;
      // const user = req.user;

      const order = await Order.findByPk(orderId);

      if (!order) {
        return next(ApiError.badRequest("Заказ не найден"));
      }

      // if (user.role !== "ADMIN" && user.email !== order.email) {
      //   return next(ApiError.forbidden("Нет доступа"));
      // }

      if (order.paid) {
        return res.json({ paid: true, order });
      }

      try {
        if (!order.paymentId) {
          return res.json({ paid: false, status: "no_payment_id" });
        }

        const payment = await yookassaService.getPayment(order.paymentId);

        if (payment.status === "succeeded") {
          await order.update({
            paid: true,
            paymentStatus: "succeeded",
            paidAt: new Date(),
          });
          return res.json({ paid: true, order });
        }

        return res.json({
          paid: false,
          status: payment.status,
          paymentUrl: order.paymentUrl,
        });
      } catch (err) {
        console.error("Error checking payment status:", err);
        return res.json({ paid: false, status: "unknown", error: err.message });
      }
    } catch (err) {
      return next(ApiError.badRequest(err.message));
    }
  }
}

module.exports = new OrderController();