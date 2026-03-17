require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");

const app = express();
const PORT = process.env.PORT || 10000;

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static files
app.use(express.static(path.join(__dirname, "public")));

// mongodb
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connect error:", err));

// api routes
app.use("/api/messages", messageRoutes);
app.use("/api/worker", workerRoutes);

// test route
app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        message: "Server is running"
    });
});

// pages
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/messages.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "messages.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});