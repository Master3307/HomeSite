import { Routes, Route } from 'react-router'
import Home from './pages/Home.jsx'
import Card from './pages/Card.jsx'
import Error from './pages/Error.jsx'
import About from './pages/About.jsx'
import Dash from './pages/HomePage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/home" element={<Home />} />
      <Route path="/heim" element={<Home />} />
      <Route path="/card" element={<Card />} />
      <Route path="/error" element={<Error />} />
      <Route path="/about" element={<About />} />
      <Route path="/dash" element={<Dash />} />
      <Route path="*" element={<Error forcedCode={404} />} />

    </Routes>
  )
}
