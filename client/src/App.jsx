import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import StrategyOverview from './pages/StrategyOverview';
import StrategyDetail from './pages/StrategyDetail';
import StrategyCompare from './pages/StrategyCompare';
import AllPositions from './pages/AllPositions';
import AllTransactions from './pages/AllTransactions';
import StrategyConfig from './pages/StrategyConfig';
import Markets from './pages/Markets';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Navbar />
        <Routes>
          <Route path="/" element={<StrategyOverview />} />
          <Route path="/strategy/:id" element={<StrategyDetail />} />
          <Route path="/compare" element={<StrategyCompare />} />
          <Route path="/positions" element={<AllPositions />} />
          <Route path="/transactions" element={<AllTransactions />} />
          <Route path="/config" element={<StrategyConfig />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
