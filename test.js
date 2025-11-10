import fetch from "node-fetch";

const PHONE_NUMBER_ID = "850549778144752"; // from your cURL URL
const TOKEN = "EAAJ3ZALJoxmwBPZBL7qNNeYgmcZCdsaZCZBZBpmt3vBZBpzH8JwNcv2m7tngWzISrFZAG9E1UQhBGwmYXH9zMjkbQK0Rm4uqHx7vu9TQf77OrYBl7WTUNSZCIBT95caBYexUnRKMSaUUxbP6oV8AI97zGDn5QXqaHnigagOnKZCbZArGtwyGmt4dfmLKUfjFHlAHWlpRuefjh49HapyfKRS9VQvBFtlRac4mLmcnhKYha09t07l33Jq6cuUZBZAfV5wRo0cXpnKyFVq6UWCygBk1FlgMAuYqgQwZDZD";
const TO_NUMBER = "918015603293"; // your verified test number (without '+')

async function sendWhatsAppTemplate() {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: TO_NUMBER,
          type: "text",
          text: {
            preview_url: true,
            body: "here is the app u asked :https://opaira.vercel.app/",
          },
        }),
      }
    );

    const data = await response.json();
    console.log("Response:", data);
  } catch (err) {
    console.error("Error:", err);
  }
}

sendWhatsAppTemplate();
