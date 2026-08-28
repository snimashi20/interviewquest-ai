import { Link, Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import History from './pages/History'
import Home from './pages/Home'
import Interview from './pages/Interview'
import Results from './pages/Results'

function App() {
  return (
    <Router>
      <nav className="nav">
        <Link to="/" className="brand">
          InterviewQuest AI
        </Link>
        <Link to="/history">History</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/interview/:interviewId" element={<Interview />} />
        <Route path="/results/:interviewId" element={<Results />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </Router>
  )
}

export default App
