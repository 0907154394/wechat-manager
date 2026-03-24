require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");

const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const accountRoutes = require("./routes/accountRoutes");

const app = express();
const PORT = process.env.PORT || 10000;

// trust proxy for Render
app.set("trust proxy", 1);

// parse body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static files
app.use(express.static(path.join(__dirname, "public")));

// connect mongodb
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connect error:", err));

// session
app.use(
    session({
        name: "wechat.sid",
        secret: process.env.SESSION_SECRET || "wechat_manager_secret_change_me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// api routes
app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/worker", workerRoutes);

// health check
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

app.get("/admin/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/messages.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "messages.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// fallback api 404
app.use("/api", (req, res) => {
    res.status(404).json({
        message: "API route not found"
    });
});

// fallback page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "public", "login.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});