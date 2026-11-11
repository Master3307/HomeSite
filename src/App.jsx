import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import Home from './pages/Home.jsx'
import Card from './pages/Card.jsx'
import Error from './pages/Error.jsx'
import About from './pages/About.jsx'
import Dash from './pages/Dash.jsx'
import Filer from './pages/Filter.jsx'
import Collect from './pages/Collect.jsx'
import Cult from './pages/Cult.jsx'
import CultProfile from './pages/CultProfile.jsx'

// Leaflet + the maps UI are big; load them only when /maps is opened.
const Maps = lazy(() => import('./pages/Maps.jsx'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Home />} />
        <Route path="/heim" element={<Home />} />
        <Route path="/card" element={<Card />} />
        <Route path="/error" element={<Error />} />
        <Route path="/about" element={<About />} />
        <Route path="/dash" element={<Dash />} />
        <Route path="/filter" element={<Filer />} />
        <Route path="/collect" element={<Collect />} />
        <Route path="/cult" element={<Cult />} />
        <Route path="/cult/profile" element={<CultProfile />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="*" element={<Error forcedCode={404} />} />

      </Routes>
    </Suspense>
  )
}
