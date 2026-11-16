import { lazy, Suspense } from 'react'
import { Navigate, Routes, Route } from 'react-router'
import Home from './pages/Home.jsx'
import Error from './pages/Error.jsx'

// Pages other than the home and error page load on demand, which keeps the
// main bundle small (Leaflet + the maps UI in particular are big).
const Card = lazy(() => import('./pages/Card.jsx'))
const About = lazy(() => import('./pages/About.jsx'))
const License = lazy(() => import('./pages/License.jsx'))
const Dash = lazy(() => import('./pages/Dash.jsx'))
const Filer = lazy(() => import('./pages/Filter.jsx'))
const Collect = lazy(() => import('./pages/Collect.jsx'))
const Cult = lazy(() => import('./pages/Cult.jsx'))
const CultProfile = lazy(() => import('./pages/CultProfile.jsx'))
const Maps = lazy(() => import('./pages/Maps.jsx'))
const Activity = lazy(() => import('./pages/Activity.jsx'))
const AdminSettings = lazy(() => import('./pages/AdminSettings.jsx'))
const Hub = lazy(() => import('./pages/Hub.jsx'))
const CultUser = lazy(() => import('./pages/CultUser.jsx'))
const CultSettings = lazy(() => import('./pages/CultSettings.jsx'))
const CultMembers = lazy(() => import('./pages/CultMembers.jsx'))
const CultPrivacy = lazy(() => import('./pages/CultPrivacy.jsx'))
const CultModeration = lazy(() => import('./pages/CultModeration.jsx'))
const CultNotifications = lazy(() => import('./pages/CultNotifications.jsx'))
const CultBirthdays = lazy(() => import('./pages/CultBirthdays.jsx'))

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
        <Route path="/license" element={<License />} />
        <Route path="/dash" element={<Dash />} />
        <Route path="/filter" element={<Filer />} />
        <Route path="/collect" element={<Collect />} />
        <Route path="/cult" element={<Cult />} />
        <Route path="/cult/profile" element={<CultProfile />} />
        <Route path="/cult/user/:key" element={<CultUser />} />
        <Route path="/cult/:handle" element={<CultUser />} />
        <Route path="/cult/settings" element={<CultSettings />} />
        <Route path="/cult/members" element={<CultMembers />} />
        <Route path="/cult/privacy" element={<CultPrivacy />} />
        <Route path="/cult/moderation" element={<CultModeration />} />
        <Route path="/cult/notifications" element={<CultNotifications />} />
        <Route path="/cult/birthdays" element={<CultBirthdays />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/admin-settings" element={<AdminSettings />} />
        <Route path="/hub" element={<Hub />} />
        <Route path="/hub/:tab" element={<Hub />} />
        <Route path="/backup" element={<Navigate to="/hub/settings#backup" replace />} />
        <Route path="*" element={<Error forcedCode={404} />} />

      </Routes>
    </Suspense>
  )
}
