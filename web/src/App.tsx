import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router'
import type { Role } from './api'
import { useAuth } from './auth'
import Audit from './pages/Audit'
import Login from './pages/Login'
import MyWins from './pages/MyWins'
import Receipt from './pages/Receipt'
import LotPage from './pages/LotPage'
import SellerPanel from './pages/SellerPanel'
import Showcase from './pages/Showcase'
import Wallet from './pages/Wallet'

// Martelo de leiloeiro (mesmo desenho do favicon).
const GavelIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m14.5 12.5-8 8a2.1 2.1 0 0 1-3-3l8-8" />
    <path d="m16 16 6-6" />
    <path d="m8 8 6-6" />
    <path d="m9 7 8 8" />
    <path d="m21 11-8-8" />
  </svg>
)

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function Header() {
  const { me, logout } = useAuth()
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand">
          <span className="brand-mark"><GavelIcon /></span>
          <span className="brand-name">Casa de Leilões</span>
        </Link>
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end>Vitrine</NavLink>
          {me?.role === 'AUCTIONEER' && <NavLink to="/painel">Painel</NavLink>}
          {me?.role === 'BIDDER' && <NavLink to="/carteira">Carteira</NavLink>}
          {me?.role === 'BIDDER' && <NavLink to="/meus-arremates">Meus arremates</NavLink>}
        </nav>
        <div className="account">
          {me ? (
            <>
              <span className="user-chip" title={me.alias}>
                <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
                <span className="user-text">
                  <strong>{me.name}</strong>
                  <small>{me.role === 'BIDDER' ? 'Licitante' : 'Leiloeiro'}</small>
                </span>
              </span>
              <button className="btn-ghost" onClick={logout}>Sair</button>
            </>
          ) : (
            <Link to="/login" className="btn">Entrar</Link>
          )}
        </div>
      </div>
    </header>
  )
}

// Guarda de rota só para UX; a autorização real é no servidor.
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return null
  if (!me) return <Navigate to="/login" replace />
  if (me.role !== role) return <p className="error">Seu perfil não tem acesso a esta página.</p>
  return children
}

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Showcase />} />
          <Route path="/login" element={<Login />} />
          <Route path="/lotes/:id" element={<LotPage />} />
          <Route path="/painel" element={<RequireRole role="AUCTIONEER"><SellerPanel /></RequireRole>} />
          <Route path="/carteira" element={<RequireRole role="BIDDER"><Wallet /></RequireRole>} />
          <Route path="/meus-arremates" element={<RequireRole role="BIDDER"><MyWins /></RequireRole>} />
          <Route path="/auditoria/:id" element={<Audit />} />
          <Route path="/comprovantes/:token" element={<Receipt />} />
          <Route path="*" element={<p className="muted">Página não encontrada.</p>} />
        </Routes>
      </main>
    </>
  )
}
