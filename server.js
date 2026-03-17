const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const Account = require("./models/Account");
const accountRoutes = require("./routes/accountRoutes");
const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const { requireAdmin, redirectIfLoggedIn } = require("./middleware/auth");

const app = express();
const publicDir = path.join(__dirname, "public");

const PORT = process.env.PORT || 3000;
const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wechat";
const SESSION_SECRET =
    process.env.SESSION_SECRET || "change_me_super_secret_session";

app.set("trust proxy", 1);

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                fontSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        crossOriginEmbedderPolicy: false
    })
);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(
    session({
        name: "wechat.sid",
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl: MONGODB_URI,
            collectionName: "sessions"
        }),
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 1000 * 60 * 60 * 12
        }
    })
);

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected");
    })
    .catch((err) => {
        console.error("MongoDB error:", err.message);
    });

function noStore(req, res, next) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    next();
}

// ===== public pages =====
app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "home.html"));
});

app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /admin\n");
});

app.get("/admin/login", noStore, redirectIfLoggedIn, (req, res) => {
    res.sendFile(path.join(publicDir, "admin-login.html"));
});

app.get("/admin", noStore, requireAdmin, (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

// chặn truy cập cũ
app.get("/login.html", (req, res) => {
    return res.redirect("/admin/login");
});

app.get("/index.html", noStore, requireAdmin, (req, res) => {
    return res.sendFile(path.join(publicDir, "index.html"));
});

// trang khách công khai
app.get("/messages.html", (req, res) => {
    res.sendFile(path.join(publicDir, "messages.html"));
});

// link khách
app.get("/m/:token", async (req, res) => {
    try {
        const fullLinkToken = "/m/" + String(req.params.token || "").trim();
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

// auth api
app.use("/api/auth", authRoutes);

// admin api
app.use("/api/accounts", requireAdmin, accountRoutes);
app.use("/api/worker", requireAdmin, workerRoutes);

// public api cho khách
app.use("/api/messages", messageRoutes);

// health
app.get("/health", (req, res) => {
    res.json({
        ok: true,
        message: "Server is running"
    });
});

// static assets để sau routes html
app.use(
    express.static(publicDir, {
        index: false,
        dotfiles: "ignore",
        etag: true
    })
);

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});