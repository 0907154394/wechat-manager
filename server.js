const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

const Account = require("./models/Account");
const accountRoutes = require("./routes/accountRoutes");
const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.use("/api/accounts", accountRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/worker", workerRoutes);

app.get("/ping", (req, res) => {
    res.send("pong");
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        message: "Server is running"
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
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

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});