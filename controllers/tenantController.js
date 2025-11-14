import Tenant from "../models/Tenant.js";

export const getAllTenants = async (req, res) => {
  const tenants = await Tenant.find().select("-__v");
  res.json(tenants);
};

export const updateTenant = async (req, res) => {
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!tenant) return res.status(404).json({ message: "Tenant not found" });

  res.json(tenant);
};