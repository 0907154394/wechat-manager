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
    },

    // Ngày đăng ký WeChat (để đếm ngược 7 ngày)
    wechatCreatedAt: {
        type: Date,
        default: null
    },

    // Thông tin người mua
    buyerInfo: {
        type: String,
        default: "",
        trim: true
    },

    // Link khách hết hạn sau 20 phút kể từ khi tạo
    linkTokenExpiresAt: {
        type: Date,
        default: null
    },

    // Lưu trữ thay vì xóa — giữ email trong DB để tránh tái sử dụng variant
    archived: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

AccountSchema.index({ messageToken: 1 });
AccountSchema.index({ linkToken: 1 });
AccountSchema.index({ imapUser: 1, imapEnabled: 1 });

module.exports = mongoose.model("Account", AccountSchema);