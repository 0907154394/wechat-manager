const mongoose = require("mongoose");

const AccountSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        trim: true
    },
    password: {
        type: String,
        default: "",
        trim: true
    },
    status: {
        type: String,
        default: "CHUA BAN",
        trim: true
    },
    wechatId: {
        type: String,
        default: "",
        trim: true
    },
    linkToken: {
        type: String,
        default: "",
        trim: true
    },
    messageToken: {
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
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Account", AccountSchema);