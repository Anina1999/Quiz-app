import { Link } from 'react-router-dom';

export default function Home() {
    return (
        <div className="page page--narrow stack">
            <h1>Здравей! 👋</h1>
            <p className="muted">Кой си ти?</p>

            <Link to="/student" className="btn btn--big btn--block">
                🎒 Аз съм ученик
            </Link>
            <Link to="/teacher" className="btn btn--big btn--block btn--secondary">
                🍎 Аз съм учител
            </Link>
        </div>
    );
}
