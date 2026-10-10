import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getTransactions, resetTpin, updateProfile, getMe } from '../services/api';
import Navbar from '../components/Navbar';
import { User, Shield, Key, History, AlertCircle, CheckCircle, Smartphone, LogOut } from 'lucide-react';

const Profile = () => {
    const { user, setUser, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('overview');
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    const [emailForm, setEmailForm] = useState({ email: '' });
    const [newTpin, setNewTpin] = useState(null);
    const [showTpinModal, setShowTpinModal] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data } = await getTransactions();
                setTransactions(data);

                const userData = await getMe();
                setUser({ ...userData.data, token: localStorage.getItem('token') });
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleEmailUpdate = async (e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        try {
            const { data } = await updateProfile({ email: emailForm.email });
            setUser({ ...user, email: data.email });
            setMessage('Email updated successfully');
            setEmailForm({ email: '' });
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update email');
        }
    };

    const handleTpinReset = async (e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        try {
            const { data } = await resetTpin({});
            setNewTpin(data.tpin);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to reset TPIN');
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <div className="min-h-screen bg-background pb-20 font-sans text-text">
            <Navbar />

            <div className="max-w-[1200px] mx-auto px-6 py-10">
                <div className="flex flex-col md:flex-row gap-8">

                    <div className="w-full md:w-64 flex-shrink-0 space-y-2">
                        <div className="bg-surface border border-border p-6 rounded-xl text-center mb-6">
                            <div className="w-20 h-20 bg-background border border-border rounded-full mx-auto flex items-center justify-center text-3xl font-bold text-primary mb-3">
                                {user?.username?.[0]?.toUpperCase()}
                            </div>
                            <h2 className="text-xl font-bold text-text truncate">{user?.username}</h2>
                            <p className="text-sm text-muted break-all">{user?.email}</p>
                            <div className="mt-4 inline-flex items-center px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                                专业账户
                            </div>
                        </div>

                        <nav className="space-y-1">
                            <button
                                onClick={() => setActiveTab('overview')}
                                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 font-medium transition-colors ${activeTab === 'overview' ? 'bg-primary text-black' : 'text-muted hover:bg-surface hover:text-text'}`}
                            >
                                <User className="w-5 h-5" /> Account Overview
                            </button>
                            <button
                                onClick={() => setActiveTab('security')}
                                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 font-medium transition-colors ${activeTab === 'security' ? 'bg-primary text-black' : 'text-muted hover:bg-surface hover:text-text'}`}
                            >
                                <Shield className="w-5 h-5" /> Security & TPIN
                            </button>
                            <button
                                onClick={() => setActiveTab('history')}
                                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 font-medium transition-colors ${activeTab === 'history' ? 'bg-primary text-black' : 'text-muted hover:bg-surface hover:text-text'}`}
                            >
                                <History className="w-5 h-5" /> Order History
                            </button>
                        </nav>

                        <div className="pt-4 mt-4 border-t border-border">
                            <button
                                onClick={logout}
                                className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                            >
                                <LogOut className="w-5 h-5" /> Logout
                            </button>
                        </div>
                    </div>

                    <div className="flex-1">
                        {message && (
                            <div className="bg-green-500/10 border border-green-500/20 text-green-500 p-4 rounded-xl mb-6 flex items-center gap-2">
                                <CheckCircle className="w-5 h-5" /> {message}
                            </div>
                        )}
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl mb-6 flex items-center gap-2">
                                <AlertCircle className="w-5 h-5" /> {error}
                            </div>
                        )}

                        {activeTab === 'overview' && (
                            <div className="space-y-6">
                                <div className="bg-surface border border-border rounded-xl p-8">
                                    <h3 className="text-xl font-bold text-text mb-6">Account Information</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <p className="text-muted text-sm mb-1">Username</p>
                                            <p className="text-text font-medium">{user?.username}</p>
                                        </div>
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <p className="text-muted text-sm mb-1">Email Address</p>
                                            <p className="text-text font-medium">{user?.email}</p>
                                        </div>
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <p className="text-muted text-sm mb-1">Total Balance</p>
                                            <p className="text-text font-medium">${user?.balance?.toLocaleString()}</p>
                                        </div>
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <p className="text-muted text-sm mb-1">Member Since</p>
                                            <p className="text-text font-medium">{formatDate(user?.createdAt)}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-surface border border-border rounded-xl p-8">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-xl font-bold text-text">Account Stats</h3>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 text-center">
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <h4 className="text-2xl font-bold text-primary">{transactions.filter(t => t.type === 'BUY').length}</h4>
                                            <p className="text-xs text-muted mt-1">Buys</p>
                                        </div>
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <h4 className="text-2xl font-bold text-accent">{transactions.filter(t => t.type === 'SELL').length}</h4>
                                            <p className="text-xs text-muted mt-1">Sells</p>
                                        </div>
                                        <div className="p-4 bg-background border border-border rounded-lg">
                                            <h4 className="text-2xl font-bold text-text">{transactions.length}</h4>
                                            <p className="text-xs text-muted mt-1">Total Trades</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className="space-y-6">
                                <div className="bg-surface border border-border rounded-xl p-8">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="text-xl font-bold text-text mb-2 flex items-center gap-2">
                                                <Smartphone className="w-5 h-5 text-primary" /> TPIN Management
                                            </h3>
                                            <p className="text-muted text-sm max-w-lg">
                                                Your TPIN is required for all buy and sell transactions. It is hashed for your security.
                                                If you forget it, you can reset it here.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => { setShowTpinModal(true); setNewTpin(null); setError(null); }}
                                            className="px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-sm font-bold hover:bg-red-500 hover:text-white transition-all"
                                        >
                                            Reset TPIN
                                        </button>
                                    </div>
                                    <div className="mt-6 p-4 bg-background border border-border rounded-lg flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-muted mb-1">Current Status</p>
                                            <p className="text-text font-medium flex items-center gap-2">
                                                <span className="w-2 h-2 bg-green-500 rounded-full"></span> Active
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-muted mb-1">Your TPIN</p>
                                            <p className="text-text font-mono text-lg tracking-widest text-primary font-bold">
                                                {user?.tpin || '****'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-surface border border-border rounded-xl p-8">
                                    <h3 className="text-xl font-bold text-text mb-6">Update Email</h3>
                                    <form onSubmit={handleEmailUpdate} className="flex flex-col md:flex-row gap-4 items-end">
                                        <div className="flex-grow w-full">
                                            <label className="block text-xs font-bold text-muted uppercase mb-2">New Email Address</label>
                                            <input
                                                type="email"
                                                className="w-full bg-background border border-border rounded-lg px-4 py-3 text-text focus:border-primary outline-none"
                                                value={emailForm.email}
                                                onChange={e => setEmailForm({ ...emailForm, email: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="w-full md:w-auto">
                                            <button type="submit" className="px-6 py-3 bg-surface border border-border hover:border-primary text-text font-bold rounded-lg transition-all w-full md:w-auto">
                                                Update Email
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div className="bg-surface border border-border rounded-xl overflow-hidden">
                                <div className="p-6 border-b border-border">
                                    <h3 className="text-xl font-bold text-text">Order History</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-background border-b border-border text-muted text-xs uppercase tracking-wider">
                                                <th className="p-4 font-bold">Symbol</th>
                                                <th className="p-4 font-bold">Type</th>
                                                <th className="p-4 font-bold text-right">Quantity</th>
                                                <th className="p-4 font-bold text-right">Price</th>
                                                <th className="p-4 font-bold text-right">Total</th>
                                                <th className="p-4 font-bold text-right">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {transactions.length > 0 ? transactions.map((tx) => (
                                                <tr key={tx._id} className="hover:bg-background/50 transition-colors">
                                                    <td className="p-4 font-bold text-text">{tx.symbol}</td>
                                                    <td className="p-4">
                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${tx.type === 'BUY' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                                                            {tx.type}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-text text-right">{tx.quantity}</td>
                                                    <td className="p-4 text-text text-right">${tx.price.toFixed(2)}</td>
                                                    <td className="p-4 text-text text-right">${(tx.price * tx.quantity).toFixed(2)}</td>
                                                    <td className="p-4 text-muted text-right text-sm">{formatDate(tx.date)}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="6" className="p-8 text-center text-muted">No transactions found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showTpinModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-surface border border-border rounded-xl w-full max-w-md p-6 shadow-2xl animate-fade-in relative">
                        <button
                            onClick={() => setShowTpinModal(false)}
                            className="absolute top-4 right-4 text-muted hover:text-text"
                        >
                            ✕
                        </button>

                        {!newTpin ? (
                            <>
                                <h3 className="text-xl font-bold text-text mb-2">Reset TPIN</h3>
                                <p className="text-muted text-sm mb-6">Are you sure you want to reset your TPIN? A new one will be generated for you instantly.</p>

                                <form onSubmit={handleTpinReset}>
                                    <button type="submit" className="w-full py-3 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-all">
                                        Generate New TPIN
                                    </button>
                                </form>
                            </>
                        ) : (
                            <div className="text-center py-6">
                                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-green-500">
                                    <CheckCircle className="w-8 h-8" />
                                </div>
                                <h3 className="text-2xl font-bold text-text mb-2">Success!</h3>
                                <p className="text-muted mb-6">Your new TPIN is:</p>
                                <div className="text-4xl font-mono font-bold text-primary bg-background border border-border rounded-xl py-4 mb-6 tracking-widest">
                                    {newTpin}
                                </div>
                                <p className="text-xs text-red-400 mb-6">Create a note of this code. It will not be shown again.</p>
                                <button
                                    onClick={() => setShowTpinModal(false)}
                                    className="w-full py-3 bg-surface border border-border hover:bg-background text-text font-bold rounded-lg transition-all"
                                >
                                    Close
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Profile;
