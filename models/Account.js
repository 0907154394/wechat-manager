const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            default: ""
        },
        status: {
            type: String,
            default: "CHUA BAN",
            enum: ["CHUA BAN", "DA BAN"]
        },
        wechatId: {
            type: String,
            default: "",
            trim: true
        },

        imapHost: {
            type: String,
            default: "",
            trim: true
        },
        imapPort: {
            type: Number,
            default: 993
        },
        imapSecure: {
            type: Boolean,
            default: true
        },
        imapUser: {
            type: String,
            default: "",
            trim: true
        },
        imapPass: {
            type: String,
            default: "",
            trim: true
        },
        imapEnabled: {
            type: Boolean,
            default: false
        },
        provider: {
            type: String,
            default: "gmail",
            trim: true
        },

        lastUid: {
            type: Number,
            default: 0
        },
        lastCheckedAt: {
            type: Date,
            default: null
        },
        workerStatus: {
            type: String,
            default: "idle",
            enum: ["idle", "checking", "connected", "error", "stopped"]
        },
        workerLastError: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

module.exports =
    mongoose.models.Account || mongoose.model("Account", accountSchema);