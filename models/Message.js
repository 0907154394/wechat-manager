const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
        required: true
    },
    sender: {
        type: String,
        default: "System",
        trim: true
    },
    subject: {
        type: String,
        default: "",
        trim: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    imapUid: {
        type: Number,
        default: null
    }
}, {
    timestamps: true
});

MessageSchema.index({ accountId: 1, createdAt: -1 });
MessageSchema.index({ accountId: 1, imapUid: 1 });

module.exports = mongoose.model("Message", MessageSchema);