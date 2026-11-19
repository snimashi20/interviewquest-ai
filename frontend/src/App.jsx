import { Link, Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import CodeWorkspace from './pages/CodeWorkspace'
import Fundamentals from './pages/Fundamentals'
import History from './pages/History'
import Home from './pages/Home'
import Interview from './pages/Interview'
import MyCV from './pages/MyCV'
import Practice from './pages/Practice'
import PracticeSession from './pages/PracticeSession'
import Results from './pages/Results'

// top level component - sets up the nav bar and all the page routes
function App() {
  return (
    <Router>
      {/* simple nav bar shown on every page */}
      <nav className="nav">
        <Link to="/" className="brand">
          InterviewQuest AI
        </Link>
        <div className="nav-tabs">
          {/* the two checklist tabs sit side by side: the topics everyone gets asked,
              and the ones specific to this student's CV */}
          <Link to="/fundamentals">Fundamentals</Link>
          <Link to="/my-cv">My CV</Link>
          {/* drill one subject at a time, with model answers and a code workspace */}
          <Link to="/practice">Practice</Link>
          <Link to="/history">History</Link>
        </div>
      </nav>
      {/* only one of these pages renders at a time, depending on the URL */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/fundamentals" element={<Fundamentals />} />
        <Route path="/my-cv" element={<MyCV />} />
        {/* practice: pick a subject, work through the questions, and code the coding ones */}
        <Route path="/practice" element={<Practice />} />
        <Route path="/practice/:interviewId" element={<PracticeSession />} />
        <Route path="/practice/:interviewId/code/:questionId" element={<CodeWorkspace />} />
        <Route path="/interview/:interviewId" element={<Interview />} />
        <Route path="/results/:interviewId" element={<Results />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </Router>
  )
}

export default App
