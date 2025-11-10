import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  from: String,         // sender number
  to: String,           // receiver number
  message: String,      // message text
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model("Message", messageSchema);
