function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
        return res.status(401).json({ message: "Chưa đăng nhập admin" });
    }

    return res.redirect("/login.html");
}

module.exports = { requireAdmin };