import fetch from "node-fetch";

const PHONE_NUMBER_ID = "850549778144752"; // from your cURL URL
const TOKEN = "EAAJ3ZALJoxmwBPz2Nhic7qDZC6C7M3rGR7EasZAdE3iB0m4TnVpKfonhsIIB8ZCayijIlTjtINNFBf51cpEKPxlaIJ9ZBIPTU03po3Xbbj0psWRLeEmzNGHLvceLy7KGudanxpXWRsS2MLrpUD8JZArnCPHWtdaNI15flTXTSYaOrJuQAZAKQppLCMVHbaKjgZBZClXSAqly4wFA2FNYycNOp7jSaYNaHpveaJ5rMKqri";
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
