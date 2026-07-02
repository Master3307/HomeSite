import { useNavigate } from 'react-router'

export default function Greeting() {
    const navigate = useNavigate()

    return (
        <div id="card" className="card">
            <h2>Greetings!</h2>
            <button onClick={() => navigate('/card')}>
                View User Card{' '}
                <span className="material-symbols-outlined">id_card</span>
            </button>
        </div>
    )
}