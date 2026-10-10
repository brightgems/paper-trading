const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Please add a name'],
        unique: true,
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true,
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        unique: true,
        match: [
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
            'Please add a valid email',
        ],
    },
    password: {
        type: String,
        minlength: 6,
        select: false
    },
    otp: {
        type: String,
        select: false,
    },
    otpExpires: {
        type: Date,
        select: false,
    },
    balance: {
        type: Number,
        default: 1000000, // 100万人民币
    },
    // A股交易设置
    tradeSettings: {
        lotSize: { type: Number, default: 100 },      // 最小交易单位100股
        tPlus1: { type: Boolean, default: true },      // T+1交易规则
        commissionRate: { type: Number, default: 0.00025 }, // 佣金费率万2.5
        stampDutyRate: { type: Number, default: 0.001 },    // 印花税千1(卖出)
        transferFeeRate: { type: Number, default: 0.00002 }, // 过户费万0.2
        minCommission: { type: Number, default: 5 },        // 最低佣金5元
    },
    tpin: {
        type: String,
        select: false
    },
    tpinLastUpdated: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
});

userSchema.pre('save', async function () {
    if (this.isModified('password')) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.matchTpin = async function (enteredTpin) {
    if (!this.tpin) return false;
    return enteredTpin === this.tpin;
};

module.exports = mongoose.model('User', userSchema);
