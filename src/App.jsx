import { Routes, Route } from 'react-router'
import Home from './pages/Home.jsx'
import Card from './pages/Card.jsx'
import Error from './pages/Error.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/card" element={<Card />} />
      <Route path="*" element={<Error forcedCode={404} />} />
    </Routes>
  )
}