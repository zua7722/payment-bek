// services/yookassa.service.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const https = require("https");

class YooKassaService {
  constructor() {
    this.shopId = process.env.YOOKASSA_SHOP_ID;
    this.secretKey = process.env.YOOKASSA_SECRET_KEY;
    this.webhookSecret = process.env.YOOKASSA_WEBHOOK_SECRET;
    this.returnUrl =
      process.env.YOOKASSA_RETURN_URL || "https://your-site.com/success";
    this.apiUrl = "https://api.yookassa.ru/v3";
    this.auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString(
      "base64",
    );
  }

  /**
   * Создание платежа
   */
  async createPayment(amount, description, metadata = {}, receiptData = null) {
    const idempotenceKey = uuidv4();

    // Формируем payload
    const payload = {
      amount: {
        value: amount.toFixed(2),
        currency: "RUB",
      },
      confirmation: {
        type: "redirect",
        return_url: this.returnUrl,
      },
      capture: true,
      description: description || "Оплата на сайте",
      metadata: {
        ...metadata,
        created_at: new Date().toISOString(),
      },
    };

    // Добавляем чек если есть данные
    if (receiptData && receiptData.email) {
      payload.receipt = {
        customer: {
          email: receiptData.email,
          ...(receiptData.fio && { full_name: receiptData.fio }),
        },
        items: [
          {
            description: receiptData.description || "Оплата услуг",
            amount: {
              value: amount.toFixed(2),
              currency: "RUB",
            },
            quantity: "1.0",
            vat_code: receiptData.vatCode || "1",
            payment_mode: "full_payment",
            payment_subject: "service",
          },
        ],
      };
    }

    console.log(
      "Creating payment with payload:",
      JSON.stringify(payload, null, 2),
    );
    console.log("Using shopId:", this.shopId);
    console.log("Auth:", this.auth ? "Present" : "Missing");

    // Отправляем запрос
    const result = await this.sendRequest("/payments", payload, idempotenceKey);

    return result;
  }

  /**
   * Отправка запроса к ЮKassa
   */
  async sendRequest(endpoint, payload, idempotenceKey) {
    const url = `${this.apiUrl}${endpoint}`;
    const jsonPayload = JSON.stringify(payload);

    console.log(`Sending request to: ${url}`);

    try {
      const response = await axios({
        method: "POST",
        url: url,
        headers: {
          "Content-Type": "application/json",
          "Idempotence-Key": idempotenceKey,
          Authorization: `Basic ${this.auth}`,
          "User-Agent": "Mozilla/5.0 (compatible; YooKassa-Payment/1.0)",
          Accept: "application/json",
        },
        data: jsonPayload,
        timeout: 45000,
        httpsAgent: this.httpsAgent,
      });

      console.log("Response status:", response.status);
      console.log("Response data:", JSON.stringify(response.data, null, 2));

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      throw new Error(
        `HTTP ${response.status}: ${JSON.stringify(response.data)}`,
      );
    } catch (error) {
      console.error("Request error details:", {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        throw new Error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        );
      } else if (error.code === "ECONNREFUSED") {
        throw new Error(
          "Не удается подключиться к платежному шлюзу. Проверьте интернет соединение.",
        );
      } else if (error.code === "ETIMEDOUT") {
        throw new Error("Превышено время ожидания ответа от платежного шлюза.");
      } else {
        throw new Error(`Ошибка соединения: ${error.message}`);
      }
    }
  }

  /**
   * Получение информации о платеже
   */
  async getPayment(paymentId) {
    try {
      const url = `${this.apiUrl}/payments/${paymentId}`;

      const response = await axios({
        method: "GET",
        url: url,
        headers: {
          Authorization: `Basic ${this.auth}`,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; YooKassa-Payment/1.0)",
        },
        timeout: 15000,
        httpsAgent: this.httpsAgent,
      });

      return response.data;
    } catch (error) {
      console.error("Error getting payment:", error.message);
      if (error.response?.status === 404) {
        throw new Error("Платеж не найден");
      }
      throw error;
    }
  }

  /**
   * Отмена платежа
   */
  async cancelPayment(paymentId) {
    const idempotenceKey = uuidv4();

    try {
      const url = `${this.apiUrl}/payments/${paymentId}/cancel`;

      const response = await axios({
        method: "POST",
        url: url,
        headers: {
          Authorization: `Basic ${this.auth}`,
          "Idempotence-Key": idempotenceKey,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; YooKassa-Payment/1.0)",
        },
        timeout: 15000,
        httpsAgent: this.httpsAgent,
      });

      return response.data;
    } catch (error) {
      console.error("Error canceling payment:", error.message);
      throw error;
    }
  }

  validateWebhookSignature(body, signature) {
    if (!this.webhookSecret || !signature) {
      console.warn("Webhook secret not configured or signature missing");
      return false;
    }

    try {
      const hash = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(JSON.stringify(body))
        .digest("base64");

      const isValid = hash === signature;
      if (!isValid) {
        console.error("Invalid webhook signature");
      }
      return isValid;
    } catch (error) {
      console.error("Error validating webhook:", error);
      return false;
    }
  }
}

module.exports = new YooKassaService();
