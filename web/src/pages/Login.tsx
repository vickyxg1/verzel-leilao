import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, type Me, type Role } from '../api'
import { useAuth } from '../auth'

export default function Login() {
  const { setMe } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'BIDDER' as Role })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form
      setMe(await api<Me>(`/auth/${mode}`, { method: 'POST', body }))
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      {mode === 'register' && (
        <>
          <label>Nome<input required minLength={2} value={form.name} onChange={set('name')} /></label>
          <label>Perfil
            <select value={form.role} onChange={set('role')}>
              <option value="BIDDER">Licitante (dá lances)</option>
              <option value="AUCTIONEER">Leiloeiro (cria lotes)</option>
            </select>
          </label>
        </>
      )}
      <label>E-mail<input type="email" required value={form.email} onChange={set('email')} autoComplete="username" /></label>
      <label>Senha<input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{mode === 'login' ? 'Entrar' : 'Cadastrar'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tenho conta'}
      </button>
      <p className="muted">Demo: leiloeiro@demo.local, ana@demo.local ou bruno@demo.local — senha demo12345</p>
    </form>
  )
}
