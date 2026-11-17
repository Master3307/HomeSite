import { lazy, Suspense, ViewTransition } from 'react'
import { Navigate, Routes, Route, useLocation, useParams } from 'react-router'
import Home from './pages/Home.jsx'
import Error from './pages/Error.jsx'
import PageLoading from './components/PageLoading.jsx'

/* /admin-settings[/<section>] and its old #hash links: the same place in the hub's settings. */
function OldSettings() {
  const { section } = useParams()
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
  const target = section || hash
  return <Navigate to={`/hub/settings${/^[a-z0-9-]+$/i.test(target) ? `/${target}` : ''}`} replace />
}

/*
 * Pages other than the home and error page load on demand, which keeps the
 * main bundle small (Leaflet + the maps UI in particular are big). Each one
 * can be fetched ahead of time: preloadPage(path) runs when a link to it is
 * hovered, focused or touched (Root.jsx), so most clicks find it ready.
 */
const PAGES = []
function page(pattern, load) {
  const Component = lazy(load)
  PAGES.push([pattern, load])
  return Component
}
const Card = page(/^\/card$/, () => import('./pages/Card.jsx'))
const About = page(/^\/about$/, () => import('./pages/About.jsx'))
const License = page(/^\/license$/, () => import('./pages/License.jsx'))
const Dash = page(/^\/dash$/, () => import('./pages/Dash.jsx'))
const Filer = page(/^\/filter$/, () => import('./pages/Filter.jsx'))
const Collect = page(/^\/collect$/, () => import('./pages/Collect.jsx'))
const Cult = page(/^\/cult$/, () => import('./pages/Cult.jsx'))
const CultProfile = page(/^\/cult\/profile$/, () => import('./pages/CultProfile.jsx'))
const Maps = page(/^\/maps$/, () => import('./pages/Maps.jsx'))
const Activity = page(/^\/activity$/, () => import('./pages/Activity.jsx'))
const Hub = page(/^\/hub(\/|$)/, () => import('./pages/Hub.jsx'))
const CultSettings = page(/^\/cult\/settings$/, () => import('./pages/CultSettings.jsx'))
const CultMembers = page(/^\/cult\/members$/, () => import('./pages/CultMembers.jsx'))
const CultStats = page(/^\/cult\/stats$/, () => import('./pages/CultStats.jsx'))
const CultPrivacy = page(/^\/cult\/privacy$/, () => import('./pages/CultPrivacy.jsx'))
const CultModeration = page(/^\/cult\/moderation$/, () => import('./pages/CultModeration.jsx'))
const CultNotifications = page(/^\/cult\/notifications$/, () => import('./pages/CultNotifications.jsx'))
const CultBirthdays = page(/^\/cult\/birthdays$/, () => import('./pages/CultBirthdays.jsx'))
// Last: any other /cult/<name> is a member's profile.
const CultUser = page(/^\/cult\/[^/]+(\/[^/]+)?$/, () => import('./pages/CultUser.jsx'))

const preloaded = new Set()
/** Starts loading the code of the page at `pathname` (once; errors are ignored, the real visit retries). */
export function preloadPage(pathname) {
  const entry = PAGES.find(([pattern]) => pattern.test(pathname))
  if (!entry || preloaded.has(entry[1])) return
  preloaded.add(entry[1])
  entry[1]().catch(() => preloaded.delete(entry[1]))
}

/*
 * Which page an address is, for the page transition: a new page fades in,
 * the old one out (main.css, ::view-transition-*). Addresses inside one page
 * (the hub's tabs, a member profile's own sub-addresses) count as the same
 * page, so they don't remount or animate.
 */
function pageKey(pathname) {
  if (pathname.startsWith('/hub')) return '/hub'
  if (pathname.startsWith('/admin-settings')) return '/admin-settings'
  return pathname.replace(/\/+$/, '') || '/'
}

export default function App() {
  const location = useLocation()
  return (
    <Suspense fallback={<PageLoading />}>
      <ViewTransition key={pageKey(location.pathname)} enter="page-in" exit="page-out" default="none">
        <Routes location={location}>
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
          <Route path="/cult/stats" element={<CultStats />} />
          <Route path="/cult/privacy" element={<CultPrivacy />} />
          <Route path="/cult/moderation" element={<CultModeration />} />
          <Route path="/cult/notifications" element={<CultNotifications />} />
          <Route path="/cult/birthdays" element={<CultBirthdays />} />
          <Route path="/maps" element={<Maps />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/hub" element={<Hub />} />
          <Route path="/hub/:tab" element={<Hub />} />
          <Route path="/hub/:tab/:section" element={<Hub />} />
          {/* The old admin page lives in the hub's settings now (sections in the address). */}
          <Route path="/admin-settings" element={<OldSettings />} />
          <Route path="/admin-settings/:section" element={<OldSettings />} />
          <Route path="/backup" element={<Navigate to="/hub/settings/backup" replace />} />
          <Route path="*" element={<Error forcedCode={404} />} />

        </Routes>
      </ViewTransition>
    </Suspense>
  )
}
