import { useState, useEffect } from 'react';
import { getPortfolio } from '../services/api';
import Navbar from '../components/Navbar';
import { DollarSign, TrendingUp, Activity } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import StopLossModal from '../components/StopLossModal';

const Holdings = () => {
    const [holdings, setHoldings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedStock, setSelectedStock] = useState(null);
    const [isStopLossModalOpen, setIsStopLossModalOpen] = useState(false);

    useEffect(() => {
        const fetchHoldings = async () => {
            try {
                const { data } = await getPortfolio();
                setHoldings(data);
                setLoading(false);
            } catch (err) {
                setLoading(false);
            }
        };

        fetchHoldings();
        const interval = setInterval(fetchHoldings, 10000);
        return () => clearInterval(interval);
    }, []);

    const totalCurrentValue = holdings.reduce((acc, item) => acc + (item.currentValue || 0), 0);
    const totalInvestedValue = holdings.reduce((acc, item) => acc + (item.avgPrice * item.quantity), 0);
    const totalReturns = totalCurrentValue - totalInvestedValue;
    const totalReturnsPercent = totalInvestedValue > 0 ? (totalReturns / totalInvestedValue) * 100 : 0;
    const totalDayChange = holdings.reduce((acc, item) => acc + (item.dayChange || 0), 0);
    const totalDayChangePercent = totalInvestedValue > 0 ? (totalDayChange / totalInvestedValue) * 100 : 0;
    const openStopLossModal = (stock) => {
        setSelectedStock(stock);
        setIsStopLossModalOpen(true);
    };

    if (loading) return <div className="text-muted text-center mt-20">Loading portfolio...</div>;

    return (
        <div className="bg-background min-h-screen text-text p-0 font-sans transition-colors duration-200">
            <Navbar />
            <div className="max-w-[1400px] mx-auto p-8">
                <header className="flex justify-between items-end mb-8 border-b border-border pb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-text mb-2">Portfolio Overview</h1>
                        <p className="text-muted text-sm">Real-time performance metrics</p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-muted mb-1">Net Liquidation Value</p>
                        <h2 className="text-4xl font-bold text-text tracking-tight">¥{totalCurrentValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
                    <div className="bg-surface border border-border p-6 rounded-lg shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-background rounded"><DollarSign className="w-5 h-5 text-blue-400" /></div>
                            <span className="text-xs font-semibold uppercase text-muted tracking-wider">Total Invested</span>
                        </div>
                        <p className="text-2xl font-bold text-text">¥{totalInvestedValue.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</p>
                    </div>

                    <div className="bg-surface border border-border p-6 rounded-lg shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-background rounded"><Activity className="w-5 h-5 text-purple-400" /></div>
                            <span className="text-xs font-semibold uppercase text-muted tracking-wider">Total P&L</span>
                        </div>
                        <p className={`text-2xl font-bold ${totalReturns >= 0 ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                            {totalReturns >= 0 ? '+' : ''}${Math.abs(totalReturns).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                        </p>
                        <span className={`text-xs font-medium ${totalReturns >= 0 ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                            {totalReturnsPercent >= 0 ? '+' : ''}{totalReturnsPercent.toFixed(2)}%
                        </span>
                    </div>

                    <div className="bg-surface border border-border p-6 rounded-lg shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-background rounded"><TrendingUp className="w-5 h-5 text-orange-400" /></div>
                            <span className="text-xs font-semibold uppercase text-muted tracking-wider">Today's P&L</span>
                        </div>
                        <p className={`text-2xl font-bold ${totalDayChange >= 0 ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                            {totalDayChange >= 0 ? '+' : ''}${Math.abs(totalDayChange).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                        </p>
                        <span className={`text-xs font-medium ${totalDayChange >= 0 ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                            {totalDayChangePercent >= 0 ? '+' : ''}{totalDayChangePercent.toFixed(2)}%
                        </span>
                    </div>

                    <div className="bg-surface border border-border p-6 rounded-lg flex items-center justify-between shadow-sm">
                        <div>
                            <span className="text-xs font-semibold uppercase text-muted tracking-wider block mb-2">Holdings</span>
                            <p className="text-3xl font-bold text-text">{holdings.length}</p>
                        </div>
                        <div className="h-full w-1 bg-border rounded-full"></div>
                    </div>
                </div>

                <div className="bg-surface border border-border rounded-lg overflow-hidden shadow-lg">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-background text-[11px] uppercase font-bold text-muted tracking-wider border-b border-border">
                                <th className="px-6 py-4">Instrument</th>
                                <th className="px-6 py-4 text-center">Trend (1D)</th>
                                <th className="px-6 py-4 text-right">Qty</th>
                                <th className="px-6 py-4 text-right">Current Price</th>
                                <th className="px-6 py-4 text-right">Invest Price</th>
                                <th className="px-6 py-4 text-right">Profit/Loss</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {holdings.map((stock) => (
                                <tr key={stock.symbol} className="hover:bg-background transition-colors group cursor-pointer" onClick={() => window.location.href = `/stock/${stock.symbol}`}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded bg-background flex items-center justify-center font-bold text-text border border-border">
                                                {stock.symbol[0]}
                                            </div>
                                            <div>
                                                <div className="font-bold text-text text-sm">{stock.symbol}</div>
                                                <div className="text-[10px] text-muted uppercase">US Stock</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 w-32">
                                        <div className="h-10 w-28">
                                            {stock.sparkline && stock.sparkline.length > 0 && (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={stock.sparkline}>
                                                        <Line
                                                            type="monotone"
                                                            dataKey="close"
                                                            stroke={stock.dayChange >= 0 ? '#00E396' : '#FF4560'}
                                                            strokeWidth={1.5}
                                                            dot={false}
                                                            isAnimationActive={false}
                                                        />
                                                        <YAxis domain={['dataMin', 'dataMax']} hide />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium text-muted">{stock.quantity}</td>
                                    <td className="px-6 py-4 text-right font-medium text-text font-mono text-sm">¥{stock.currentPrice.toFixed(2)}</td>
                                    <td className="px-6 py-4 text-right text-muted font-mono text-sm">¥{stock.avgPrice.toFixed(2)}</td>
                                    <td className="px-6 py-4 text-right">
                                        <div className={`text-sm font-bold ${stock.pnl >= 0 ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                                            {stock.pnl >= 0 ? '+' : ''}${Math.abs(stock.pnl).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                                        </div>
                                        <div className={`text-[10px] ${stock.pnl >= 0 ? 'text-[#00E396]/70' : 'text-[#FF4560]/70'}`}>
                                            {stock.pnlPercentage.toFixed(2)}%
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {holdings.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-muted italic">
                                        No active holdings. start trading to build your portfolio.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            {selectedStock && (
                <StopLossModal
                    isOpen={isStopLossModalOpen}
                    onClose={() => setIsStopLossModalOpen(false)}
                    symbol={selectedStock.symbol}
                    currentPrice={selectedStock.currentPrice}
                    onSuccess={() => { }}
                />
            )}
        </div>
    );
};

export default Holdings;
