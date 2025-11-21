import Tenant from "../models/Tenant.js";

export const getAllTenants = async (req, res) => {
  const tenants = await Tenant.find().select("-__v");
  res.json(tenants);
};

export const verifyCredentials = async (req, res) => {
  const { phoneNumberId, accessToken, metaAppId } = req.body;
  
    if (!phoneNumberId || !accessToken || !metaAppId) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
  
    try {
      // Step 1: Test the access token by calling WhatsApp API
      const response = await axios.get(
        `https://graph.facebook.com/v20.0/${phoneNumberId}`,
        {
          params: {
            fields: "name,verified_name",
            access_token: accessToken,
          },
          timeout: 8000,
        }
      );
  
      const phoneData = response.data;
  
      // Step 2: Verify this phone number belongs to the app
      const appCheck = await axios.get(
        `https://graph.facebook.com/v20.0/debug_token`,
        {
          params: {
            input_token: accessToken,
            access_token: accessToken,
          },
          timeout: 8000,
        }
      );
  
      const debugToken = appCheck.data.data;
  
      if (debugToken.app_id !== metaAppId) {
        return res.status(400).json({
          success: false,
          message: "Access token does not belong to this Meta App ID",
        });
      }
  
      if (!debugToken.is_valid) {
        return res.status(400).json({
          success: false,
          message: "Access token is expired or invalid",
        });
      }
  
      // Optional: Check if phone number is verified
      const isVerified = phoneData.verified_name ? true : false;
  
      res.json({
        success: true,
        message: "Credentials verified successfully!",
        data: {
          businessName: phoneData.name || phoneData.verified_name,
          verified: isVerified,
          phoneNumberId,
        },
      });
    } catch (err) {
      console.error("Verification failed:", err.response?.data || err.message);
  
      let message = "Invalid credentials. Please check your inputs.";
  
      if (err.response?.status === 400) {
        message = "Invalid Phone Number ID or Access Token";
      } else if (err.response?.status === 403) {
        message = "Access denied. Token may lack permissions";
      } else if (err.code === "ECONNABORTED") {
        message = "Request timed out. Check your connection";
      }
  
      res.status(400).json({
        success: false,
        message,
      });
    }
  
};
export const TenantOnboarding = async (req, res) => {
  
  const { phoneNumberId, accessToken, metaAppId } = req.body;
  const userId = req.user._id;
  const tenantId = req.user.tenantId;

  try {
    // 1. Save tenant credentials
    await Tenant.findByIdAndUpdate(tenantId, {
      phoneNumberId,
      accessToken,
      metaAppId,
      status: "active",
    });

    await User.findByIdAndUpdate(userId, { hasOnboarded: true });

    // 2. AUTO SETUP WEBHOOK
    const webhookUrl = `${process.env.BACKEND_URL}/webhook`; // e.g. https://yourapp.onrender.com/webhook/whatsapp
    const verifyToken = process.env.VERIFY_TOKEN ;

    const fields = "messages,message_statuses";

    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/subscribed_apps`,
      null,
      {
        params: {
          subscribed_fields: fields,
          access_token: accessToken,
          verify_token: verifyToken,
          callback_url: webhookUrl,
        },
        timeout: 10000,
      }
    );

    console.log(`Webhook auto-subscribed for tenant ${tenantId}`);

    res.json({
      success: true,
      message: "Connected & Webhook activated!",
      webhookUrl,
    });
  } catch (err) {
    console.error("Webhook setup failed:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: "Connected, but webhook failed. Contact support.",
    });
  }

};

export const updateTenant = async (req, res) => {
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!tenant) return res.status(404).json({ message: "Tenant not found" });

  res.json(tenant);
};