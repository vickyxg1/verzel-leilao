import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router'
import type { Role } from './api'
import { useAuth } from './auth'
import Login from './pages/Login'
import LotPage from './pages/LotPage'
import SellerPanel from './pages/SellerPanel'
import Showcase from './pages/Showcase'

function Header() {
  const { me, logout } = useAuth()
  return (
    <header className="header">
      <Link to="/" className="brand">Casa de Leilões</Link>
      <nav>
        <Link to="/">Vitrine</Link>
        {me?.role === 'AUCTIONEER' && <Link to="/painel">Painel</Link>}
        {me ? (
          <>
            <span className="muted">{me.name} · {me.role === 'BIDDER' ? 'Licitante' : 'Leiloeiro'}</span>
            <button className="link" onClick={logout}>Sair</button>
          </>
        ) : (
          <Link to="/login">Entrar</Link>
        )}
      </nav>
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
          <Route path="*" element={<p className="muted">Página não encontrada.</p>} />
        </Routes>
      </main>
    </>
  )
}
