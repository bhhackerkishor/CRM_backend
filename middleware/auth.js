import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "chatcom-secret-2025";

export const protect = async (req, res, next) => {
  let token;
  
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) return res.status(401).json({ message: "User not found" });

    req.user = user;
    req.tenantId = user.tenant; // convenience
    next();
  } catch (err) {
    res.status(401).json({ message: "Token invalid or expired" });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `Role '${req.user.role}' not allowed` });
    }
    next();
  };
};