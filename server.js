const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");

const Account = require("./models/Account");
const accountRoutes = require("./routes/accountRoutes");
const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const { requireAdmin } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || "wechat_manager_secret_2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 12
    }
}));

app.use(express.static(path.join(__dirname, "public")));

const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wechat";

const PORT = process.env.PORT || 3000;

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected");
    })
    .catch((err) => {
        console.error("MongoDB error:", err.message);
    });

app.use("/api/auth", authRoutes);

// route công khai cho khách
app.get("/messages.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "messages.html"));
});

app.get("/m/:token", async (req, res) => {
    try {
        const fullLinkToken = "/m/" + String(req.params.token).trim();

        const account = await Account.findOne({ linkToken: fullLinkToken });

        if (!account) {
            return res.status(404).send("Link không hợp lệ");
        }

        if (!account.messageToken) {
            return res.status(400).send("Account chưa có message token");
        }

        return res.redirect(
            "/messages.html?token=" + encodeURIComponent(account.messageToken)
        );
    } catch (error) {
        console.error("route /m/:token error:", error);
        return res.status(500).send("Lỗi hệ thống");
    }
});

// trang login công khai
app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// khóa trang admin
app.get("/", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/index.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// khóa api admin
app.use("/api/accounts", requireAdmin, accountRoutes);
app.use("/api/worker", requireAdmin, workerRoutes);

// api messages cho khách vẫn công khai theo token
app.use("/api/messages", messageRoutes);

// test route
app.get("/ping", (req, res) => {
    res.send("pong");
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        message: "Server is running"
    });
});

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});