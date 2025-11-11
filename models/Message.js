import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },      // sender's number or ID
  to: { type: String, required: true },        // receiver's number or ID
  message: { type: String, required: true },   // message text
  direction: {                                 // 'in' for incoming, 'out' for outgoing
    type: String,
    enum: ["in", "out"],
    required: true,
  },
  status: {                                    // 'sent', 'delivered', 'read'
    type: String,
    default: "sent",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Message", messageSchema);
