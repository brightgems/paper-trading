import { Link, useLocation } from 'react-router-dom';
import { BarChart3, GitCompare, Wallet, ArrowLeftRight, Settings, TrendingUp } from 'lucide-react';

const navItems = [
  { to: '/', label: '策略总览', icon: BarChart3 },
  { to: '/compare', label: '策略对比', icon: GitCompare },
  { to: '/positions', label: '持仓看板', icon: Wallet },
  { to: '/transactions', label: '交易流水', icon: ArrowLeftRight },
  { to: '/config', label: '策略配置', icon: Settings },
  { to: '/markets', label: '行情', icon: TrendingUp },
];

const Navbar = () => {
  const location = useLocation();
  return (
    <nav className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700">
      <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold text-slate-100">
          <BarChart3 className="w-7 h-7 text-blue-400" />
          <span>模拟盘追踪</span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
