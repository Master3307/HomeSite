import { useNavigate } from 'react-router'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import About from '../components/About.jsx'
import Greeting from '../components/Greeting.jsx'
export default function Home() {


  return (
    <>
      <header className="head">
        <h1 className="tit">
          Home of<b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <Greeting />
      <About />

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}