const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true
        },

        subject: {
            type: String,
            default: "",
            trim: true
        },

        sender: {
            type: String,
            default: "",
            trim: true
        },

        content: {
            type: String,
            default: ""
        },

        code: {
            type: String,
            default: "",
            trim: true
        },

        uid: {
            type: Number,
            default: 0,
            index: true
        },

        messageId: {
            type: String,
            default: "",
            trim: true
        },

        receivedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

// Tăng tốc truy vấn lấy inbox theo account
messageSchema.index({ accountId: 1, createdAt: -1 });

// Tránh lưu trùng mail nếu worker đọc lại cùng 1 email
messageSchema.index(
    { accountId: 1, uid: 1 },
    {
        unique: true,
        partialFilterExpression: { uid: { $gt: 0 } }
    }
);

// Tránh trùng theo messageId nếu có
messageSchema.index(
    { accountId: 1, messageId: 1 },
    {
        unique: true,
        partialFilterExpression: { messageId: { $type: "string", $ne: "" } }
    }
);

module.exports =
    mongoose.models.Message || mongoose.model("Message", messageSchema);