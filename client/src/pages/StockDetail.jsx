import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api, { getStockPrice, getStockCandles, getCompanyProfile, getFinancials, getRecommendations, getCompanyNews } from '../services/api';
import { BadgeCheck, Globe, TrendingUp, DollarSign } from 'lucide-react';
import TpinModal from '../components/TpinModal';

const StockDetail = () => {
    const { symbol } = useParams();
    const navigate = useNavigate();

    const [price, setPrice] = useState(null);
    const [profile, setProfile] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [financials, setFinancials] = useState(null);
    const [recommendations, setRecommendations] = useState([]);
    const [news, setNews] = useState([]);

    const [activeTab, setActiveTab] = useState('Overview');
    const [timeRange, setTimeRange] = useState('1D');
    const [quantity, setQuantity] = useState('');
    const [orderType, setOrderType] = useState('BUY');
    const [showTpinModal, setShowTpinModal] = useState(false);

    useEffect(() => {
        const fetchAllData = async () => {
            try {
                const [priceRes, profileRes, recsRes, newsRes] = await Promise.all([
                    getStockPrice(symbol),
                    getCompanyProfile(symbol),
                    getRecommendations(symbol),
                    getCompanyNews(symbol)
                ]);

                setPrice(priceRes.data.price);
                setProfile(profileRes.data);
                setRecommendations(recsRes.data);
                setNews(newsRes.data);

                const candles = await getStockCandles(symbol, timeRange);
                setChartData(candles.data);

                const fins = await getFinancials(symbol);
                setFinancials(fins.data.metric);

            } catch (error) {
                console.error("Error loading stock data", error);
            }
        };
        fetchAllData();
    }, [symbol, timeRange]);

    const handleTradeClick = (e) => {
        e.preventDefault();
        if (!quantity || quantity <= 0) {
            alert('Please enter a valid quantity');
            return;
        }
        setShowTpinModal(true);
    };

    const handleTpinVerify = async (tpin) => {
        try {
            const endpoint = `/trade/${orderType.toLowerCase()}`;
            await api.post(endpoint, { symbol, quantity, tpin });
            alert('Order Executed Successfully!');
            navigate('/dashboard');
        } catch (error) {
            throw error; // Let modal handle error display
        }
    };

    const isPositive = chartData.length > 0 && chartData[chartData.length - 1].close >= chartData[0].close;
    const chartColor = isPositive ? "#00E396" : "#FF4560";
    const gradientId = `colorPrice-${isPositive ? 'up' : 'down'}`;

    return (
        <div className="min-h-screen bg-background text-text font-sans pb-20">
            <TpinModal
                isOpen={showTpinModal}
                onClose={() => setShowTpinModal(false)}
                onVerify={handleTpinVerify}
                type={orderType}
                symbol={symbol}
                quantity={quantity}
                price={price}
            />
            <Navbar />


            <div className="bg-surface border-b border-border pt-8 pb-6 px-4">
                <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-4">
                        {profile?.logo && <img src={profile.logo} alt={symbol} className="w-16 h-16 rounded-lg bg-surface p-1 border border-border" />}
                        <div>
                            <h1 className="text-3xl font-bold text-text flex items-center gap-2">
                                {profile?.name || symbol}
                                {profile?.exchange && <span className="text-xs bg-background text-muted px-2 py-1 rounded border border-border">{profile.exchange}</span>}
                            </h1>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted">
                                <span>{symbol}</span>
                                {profile?.weburl ? (
                                    <a href={profile.weburl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary">
                                        <Globe className="w-3 h-3" /> Website
                                    </a>
                                ) : null}
                                <span className="flex items-center gap-1"><BadgeCheck className="w-3 h-3 text-primary" /> FINNHUB VERIFIED</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <h2 className="text-4xl font-bold text-text">${price?.toLocaleString()}</h2>
                        {chartData.length > 0 && (
                            <p className={`text-sm font-medium mt-1 ${isPositive ? 'text-[#00E396]' : 'text-[#FF4560]'}`}>
                                Live Market Data
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-[1400px] mx-auto px-4 py-8 grid grid-cols-12 gap-8">


                <div className="col-span-12 lg:col-span-9 space-y-8">


                    <div className="bg-surface border border-border rounded-xl p-6 h-[500px]">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex bg-background rounded-lg p-1 border border-border">
                                {['1D', '1W', '1M', '6M', '1Y'].map(range => (
                                    <button
                                        key={range}
                                        onClick={() => setTimeRange(range)}
                                        className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${timeRange === range ? 'bg-surface text-text shadow-sm border border-border' : 'text-muted hover:text-text'}`}
                                    >
                                        {range}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height="85%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.2} />
                                        <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" hide />
                                <YAxis domain={['auto', 'auto']} orientation="right" tick={{ fill: 'var(--color-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: '8px', color: 'var(--color-text)' }}
                                    itemStyle={{ color: chartColor }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="close"
                                    stroke={chartColor}
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill={`url(#${gradientId})`}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>


                    <div className="bg-surface border border-border rounded-xl overflow-hidden min-h-[400px]">
                        <div className="border-b border-border px-6 flex gap-8">
                            {['Overview', 'Financials', 'News'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        <div className="p-6">
                            {activeTab === 'Overview' && financials && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    <MetricBox label="总市值" value={financials.marketCapitalization ? `$${financials.marketCapitalization.toLocaleString()} M` : '-'} />
                                    <MetricBox label="52周高" value={financials['52WeekHigh'] ? `$${financials['52WeekHigh']}` : '-'} />
                                    <MetricBox label="52周低" value={financials['52WeekLow'] ? `$${financials['52WeekLow']}` : '-'} />
                                    <MetricBox label="P/E Ratio" value={financials.peTTM ? financials.peTTM.toFixed(2) : '-'} />
                                    <MetricBox label="EPS" value={financials.epsTTM ? financials.epsTTM.toFixed(2) : '-'} />
                                    <MetricBox label="Div Yield" value={financials.dividendYieldIndicatedAnnual ? `${financials.dividendYieldIndicatedAnnual.toFixed(2)}%` : '-'} />
                                    <MetricBox label="Beta" value={financials.beta ? financials.beta.toFixed(2) : '-'} />
                                </div>
                            )}

                            {activeTab === 'Financials' && (
                                <div className="text-center py-10 text-muted">
                                    <p>Detailed Financial Statements Table (Income/Balance/Cash Flow)</p>
                                    <p className="text-xs mt-2">Data provided by Finnhub Pro</p>
                                </div>
                            )}

                            {activeTab === 'News' && (
                                <div className="space-y-4">
                                    {news.map((item) => (
                                        <a key={item.id} href={item.url} target="_blank" className="block p-4 rounded-lg bg-background hover:bg-surface border border-transparent hover:border-border transition-colors">
                                            <h4 className="text-text font-medium">{item.headline}</h4>
                                            <p className="text-xs text-muted mt-2">{item.source} - {new Date(item.datetime * 1000).toLocaleDateString()}</p>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                </div>


                <div className="col-span-12 lg:col-span-3 space-y-6">


                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-lg font-bold text-text mb-4">Trade {symbol}</h3>
                        <div className="flex bg-background rounded-lg p-1 mb-4 border border-border">
                            <button onClick={() => setOrderType('BUY')} className={`flex-1 py-2 text-sm font-bold rounded ${orderType === 'BUY' ? 'bg-primary text-black' : 'text-muted hover:text-text'}`}>Buy</button>
                            <button onClick={() => setOrderType('SELL')} className={`flex-1 py-2 text-sm font-bold rounded ${orderType === 'SELL' ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}>Sell</button>
                        </div>
                        <form onSubmit={handleTradeClick} className="space-y-4">
                            <div>
                                <label className="text-xs text-muted mb-1 block">Quantity</label>
                                <input
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => setQuantity(e.target.value)}
                                    className="w-full bg-background border border-border text-text rounded-lg p-3 outline-none focus:border-primary"
                                    placeholder="0"
                                />
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted">Est. Cost</span>
                                <span className="text-text font-medium">${(price * (quantity || 0)).toLocaleString()}</span>
                            </div>
                            <button className="w-full py-3 bg-primary text-black font-bold rounded-lg hover:bg-primary/90 transition-colors">
                                Submit Order
                            </button>
                        </form>
                    </div>


                    {recommendations.length > 0 && (
                        <div className="bg-surface border border-border rounded-xl p-6">
                            <h3 className="text-lg font-bold text-text mb-4">Analyst Ratings</h3>
                            <div className="space-y-2">

                                <div className="flex justify-between text-sm">
                                    <span className="text-primary">Buy</span>
                                    <span className="text-text">{recommendations[0].buy}</span>
                                </div>
                                <div className="w-full bg-background h-2 rounded-full overflow-hidden border border-border">
                                    <div className="bg-primary h-full" style={{ width: `${(recommendations[0].buy / (recommendations[0].buy + recommendations[0].hold + recommendations[0].sell)) * 100}%` }}></div>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-yellow-500">Hold</span>
                                    <span className="text-text">{recommendations[0].hold}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-accent">Sell</span>
                                    <span className="text-text">{recommendations[0].sell}</span>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

            </div>
        </div>
    );
};

const MetricBox = ({ label, value }) => (
    <div className="bg-background p-4 rounded-lg border border-border">
        <p className="text-xs text-muted mb-1">{label}</p>
        <p className="text-sm font-bold text-text">{value || '-'}</p>
    </div>
)

export default StockDetail;
