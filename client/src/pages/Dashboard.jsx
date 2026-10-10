import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import api, { getPortfolio, getIndices } from '../services/api';
import StockCard from '../components/StockCard';
import MarketNews from '../components/MarketNews';
import StopLossModal from '../components/StopLossModal';
import { ArrowUpRight, TrendingUp, DollarSign, Activity, ShieldAlert } from 'lucide-react';

const Dashboard = () => {
    const [portfolio, setPortfolio] = useState([]);
    const [totalValue, setTotalValue] = useState(0);
    const [balance, setBalance] = useState(0);

    const [indices, setIndices] = useState([]);
    const [trending, setTrending] = useState([]);
    const [gainers, setGainers] = useState([]);
    const [losers, setLosers] = useState([]);

    const [selectedStock, setSelectedStock] = useState(null);
    const [isStopLossModalOpen, setIsStopLossModalOpen] = useState(false);

    const fetchPortfolioData = async () => {
        try {
            const { data: portfolioData } = await getPortfolio();
            setPortfolio(portfolioData);
            const total = portfolioData.reduce((acc, item) => acc + item.currentValue, 0);
            setTotalValue(total);

            const { data: userData } = await api.get('/auth/me');
            setBalance(userData.balance);
        } catch (error) {
            console.error("Failed to fetch portfolio", error);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                await fetchPortfolioData();

                const { data: indicesData } = await getIndices();
                setIndices(indicesData);

                const [activeRes, gainersRes, losersRes] = await Promise.all([
                    api.get('/trade/movers?type=active'),
                    api.get('/trade/movers?type=gainers'),
                    api.get('/trade/movers?type=losers')
                ]);
                setTrending(activeRes.data);
                setGainers(gainersRes.data);
                setLosers(losersRes.data);

            } catch (error) {
                console.error("Failed to fetch data", error);
            }
        };
        fetchData();
    }, []);

    const openStopLossModal = (stock) => {
        setSelectedStock(stock);
        setIsStopLossModalOpen(true);
    };

    const StockRow = ({ title, icon: Icon, data, color }) => (
        <section className="mb-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-text flex items-center gap-2">
                    <Icon className={`w-5 h-5 ${color}`} /> {title}
                </h2>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
                {data.length > 0 ? data.map((stock, i) => (
                    <StockCard key={i} {...stock} />
                )) : (
                    <div className="text-muted text-sm">加载行情中...</div>
                )}
            </div>
        </section>
    );

    return (
        <div className="min-h-screen bg-background pb-20 text-muted font-sans transition-colors duration-200">
            <Navbar />

            <div className="max-w-[1400px] mx-auto px-6 py-8">

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {indices.map((idx, i) => (
                        <a href={`/stock/${idx.symbol}`} key={i} className="bg-surface border border-border p-5 rounded-xl flex justify-between items-center hover:border-gray-500 transition-colors cursor-pointer group">
                            <div>
                                <h3 className="text-sm text-muted font-medium mb-1 group-hover:text-primary transition-colors">{idx.name}</h3>
                                <p className="text-xl font-bold text-text">{idx.price?.toFixed(2)}</p>
                            </div>
                            <div className={`px-2 py-1 rounded text-sm font-bold ${idx.changePercent < 0 ? 'text-accent bg-accent/10' : 'text-primary bg-primary/10'}`}>
                                {idx.changePercent > 0 ? '+' : ''}{idx.changePercent?.toFixed(2)}%
                            </div>
                        </a>
                    ))}
                </div>

                <div className="grid grid-cols-12 gap-8">
                    <div className="col-span-12 lg:col-span-8 space-y-2">

                        <div className="bg-gradient-to-r from-surface to-background border border-border rounded-xl p-8 flex justify-between items-center shadow-lg relative overflow-hidden mb-8">
                            <div className="relative z-10">
                                <p className="text-muted mb-2 font-medium flex items-center gap-2"><BriefcaseIcon className="w-4 h-4" /> 总资产</p>
                                <h1 className="text-4xl font-bold text-text mb-2">¥{totalValue.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</h1>
                                <p className="text-primary text-sm font-medium flex items-center gap-1">
                                    <TrendingUp className="w-4 h-4" /> +¥0.00 (Today)
                                </p>
                            </div>
                            <div className="text-right relative z-10">
                                <p className="text-muted mb-1 text-sm font-medium">可用资金</p>
                                <p className="text-xl font-semibold text-text">¥{balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</p>
                                <button className="mt-4 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary hover:text-black font-bold text-sm transition-all">充值</button>
                            </div>
                            <div className="absolute right-0 bottom-0 opacity-10">
                                <Activity className="w-48 h-48 text-primary" />
                            </div>
                        </div>

                        <StockRow title="热门股" icon={Activity} data={trending} color="text-yellow-500" />
                        <StockRow title="涨幅榜" icon={TrendingUp} data={gainers} color="text-primary" />
                        <StockRow title="跌幅榜" icon={ArrowUpRight} data={losers} color="text-accent" />


                    </div>

                    <div className="col-span-12 lg:col-span-4 space-y-8">
                        <MarketNews />

                    </div>
                </div>
            </div>

            {selectedStock && (
                <StopLossModal
                    isOpen={isStopLossModalOpen}
                    onClose={() => setIsStopLossModalOpen(false)}
                    symbol={selectedStock.symbol}
                    currentPrice={selectedStock.currentPrice}
                    onSuccess={fetchPortfolioData}
                />
            )}
        </div>
    );
};


const BriefcaseIcon = ({ className }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
)

export default Dashboard;
