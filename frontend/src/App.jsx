import { Link, Route, BrowserRouter as Router, Routes } from 'react-router-dom'
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
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/interview/:interviewId" element={<Interview />} />
        <Route path="/results/:interviewId" element={<Results />} />
      </Routes>
    </Router>
  )
}

export default App
