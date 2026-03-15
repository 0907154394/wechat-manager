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
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Message", MessageSchema);