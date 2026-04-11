const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

const Account = require("./models/Account");
const accountRoutes = require("./routes/accountRoutes");
const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const { authMiddleware } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wechat";

const PORT = process.env.PORT || 3000;

// MongoDB connect
mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected");
    })
    .catch((err) => {
        console.error("MongoDB error:", err.message);
    });

// Public auth route (no auth required)
app.use("/api/auth", authRoutes);

// Protected admin API routes
app.use("/api/accounts", authMiddleware, accountRoutes);
app.use("/api/worker", authMiddleware, workerRoutes);

// Public message route (customer access via token)
app.use("/api/messages", messageRoutes);

// Health checks (public)
app.get("/ping", (req, res) => {
    res.send("pong");
});

app.get("/health", (req, res) => {
    res.json({ ok: true, message: "Server is running" });
});

// Public customer link route
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

// Serve static files (login.html, messages.html, CSS, JS)
// index.html is NOT served by static - handled below with auth guard
app.use(
    express.static(path.join(__dirname, "public"), {
        index: false // prevent auto-serving index.html
    })
);

// Admin dashboard - served only to authenticated users
// (JS-level auth: the page itself checks localStorage token)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Fallback
app.use((req, res) => {
    res.status(404).send("Not Found");
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
