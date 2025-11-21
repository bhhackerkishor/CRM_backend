import jwt from "jsonwebtoken";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "chatcom-secret-2025";
const EXPIRES_IN = "7d";

const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: EXPIRES_IN });

// backend/controllers/authController.js
export const signup = async (req, res) => {
  const { businessName, whatsappNumber, name, email, password } = req.body;

  try {
    const tenant = await Tenant.create({
      businessName,
      whatsappNumber,
      status: "pending"
    });

    const user = await User.create({
      tenantId: tenant._id,
      name,
      email,
      password,
      role: "admin",
      hasOnboarded: false  // ← important
    });

    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        tenantId: tenant._id,
        hasOnboarded: false
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
export const login = async (req, res) => {
  console.log(req.body,"SOmeone truing to login")
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  
  const token = signToken(user._id);
  console.log(user)

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
  });
};

export const getMe = async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");
  res.json({ user });
};