function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    const wantsJson =
        req.headers.accept &&
        req.headers.accept.includes("application/json");

    if (wantsJson) {
        return res.status(401).json({ message: "Chưa đăng nhập admin" });
    }

    return res.redirect("/admin/login");
}

function redirectIfLoggedIn(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return res.redirect("/admin");
    }

    return next();
}

module.exports = {
    requireAdmin,
    redirectIfLoggedIn
};