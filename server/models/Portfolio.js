const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    symbol: {
        type: String,
        required: true,
    },
    quantity: {
        type: Number,
        required: true,
        default: 0,
    },
    availableQuantity: {
        type: Number,
        default: 0,  // T+1: 可卖数量(今日买入的不计入)
    },
    avgPrice: {
        type: Number,
        required: true,
        default: 0,
    },
    stopLossPrice: {
        type: Number,
        default: null,
    },
    stopLossType: {
        type: String,
        enum: ['price', 'percent', null],
        default: null,
    },
    stopLossValue: {
        type: Number,
        default: null,
    },
    stopLossActive: {
        type: Boolean,
        default: false,
    },
});

portfolioSchema.index({ user: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('Portfolio', portfolioSchema);
