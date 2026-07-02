import { useNavigate } from 'react-router'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'

export default function Home() {
  const navigate = useNavigate()

  return (
    <>
      <header className="head">
        <h1 className="tit">
          Home of<b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <div id="card" className="card">
        <h2>Greetings!</h2>
        <p>You must have found this Website!</p>
        <br />
        <p>That is very nice, you know. Feel free to look around!</p>
        <br />
        <p>View my User Info and see more Projects here:</p>
        <button onClick={() => navigate('/card')}>
          View User Card{' '}
          <span className="material-symbols-outlined">id_card</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: '32px' }}>
        <h2>About This Website</h2>
        <p>
          This is a personal website of mine, where I share some of my projects
          and information about myself.
        </p>
      </div>

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}