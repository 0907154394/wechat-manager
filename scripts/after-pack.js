/**
 * afterPack hook — repo is public, no token injection needed.
 * Auto-updater can download releases without authentication.
 */
exports.default = async (_context) => {
    // nothing to do for public repo
};
