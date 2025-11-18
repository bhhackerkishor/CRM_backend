import mongoose from "mongoose";

const templateSchema = new mongoose.Schema({
  name: String,
  language: String,
  status: String,
  category: String,
  components: Array,
}, { timestamps: true });

export default mongoose.model("Template", templateSchema);
