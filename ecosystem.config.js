module.exports = {
    apps: [
        {
            name: "wechat-web",
            script: "server.js",
            watch: false,
            env: {
                NODE_ENV: "production",
                PORT: 3000
            },
            restart_delay: 3000,
            max_restarts: 10,
            log_date_format: "YYYY-MM-DD HH:mm:ss"
        },
        {
            name: "wechat-tunnel",
            script: "cloudflare-worker.js",
            watch: false,
            restart_delay: 8000,
            max_restarts: 5,
            log_date_format: "YYYY-MM-DD HH:mm:ss"
        }
    ]
};
