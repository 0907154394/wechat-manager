require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");

const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const accountRoutes = require("./routes/accountRoutes");
const { requireAdmin, redirectIfLoggedIn } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connect error:", err));

/**
 * =========================
 * API ROUTES
 * =========================
 */
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

// bảo vệ toàn bộ api admin
app.use("/api/accounts", requireAdmin, accountRoutes);
app.use("/api/worker", requireAdmin, workerRoutes);

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        message: "Server is running"
    });
});

/**
 * =========================
 * PUBLIC TOKEN ROUTE
 * Khách vào link token không cần login
 * =========================
 */
app.get("/m/:token", (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "messages.html"));
});

/**
 * =========================
 * STATIC FILES
 * =========================
 */
app.use(express.static(path.join(__dirname, "public")));

/**
 * =========================
 * ADMIN PAGE ROUTES
 * =========================
 */

// vào root thì bắt login admin
app.get("/", (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.redirect("/admin");
    }
    return res.redirect("/admin/login");
});

app.get("/home", requireAdmin, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/admin/login", redirectIfLoggedIn, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login", redirectIfLoggedIn, (req, res) => {
    return res.redirect("/admin/login");
});

app.get("/admin", requireAdmin, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * Không cho vào messages.html trực tiếp
 * Chỉ được vào qua /m/:token
 */
app.get("/messages.html", (req, res) => {
    return res.redirect("/admin/login");
});

/**
 * Không cho vào trực tiếp các trang html nội bộ nếu chưa login
 */
app.get("/index.html", requireAdmin, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/home.html", requireAdmin, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/login.html", redirectIfLoggedIn, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/admin-login.html", redirectIfLoggedIn, (req, res) => {
    return res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

/**
 * =========================
 * 404 API
 * =========================
 */
app.use("/api", (req, res) => {
    return res.status(404).json({
        message: "API route not found"
    });
});

/**
 * =========================
 * CATCH-ALL
 * - Nếu là /m/... thì vẫn cho vào messages.html
 * - Còn lại: admin thì vào /admin, chưa login thì về /admin/login
 * =========================
 */
app.use((req, res) => {
    if (req.path.startsWith("/m/")) {
        return res.sendFile(path.join(__dirname, "public", "messages.html"));
    }

    if (req.session && req.session.isAdmin) {
        return res.redirect("/admin");
    }

    return res.redirect("/admin/login");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});