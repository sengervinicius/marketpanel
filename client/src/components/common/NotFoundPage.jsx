import { useNavigate } from 'react-router-dom';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="not-found-container">
      <div className="not-found-content">
        <div className="not-found-404">404</div>
        <h1 className="not-found-heading">Page Not Found</h1>
        <p className="not-found-subtext">The route you're looking for doesn't exist.</p>
        <button
          className="not-found-button"
          onClick={() => navigate('/')}
        >
          BACK TO TERMINAL
        </button>
      </div>
    </div>
  );
}
