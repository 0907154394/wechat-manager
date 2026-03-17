const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true
        },
        sender: { type: String, default: "" },
        subject: { type: String, default: "" },
        content: { type: String, default: "" },
        code: { type: String, default: "" },
        uid: { type: Number, required: true },
        rawDate: { type: Date, default: null }
    },
    { timestamps: true }
);

messageSchema.index({ accountId: 1, uid: 1 }, { unique: true });

module.exports =
    mongoose.models.Message || mongoose.model("Message", messageSchema);