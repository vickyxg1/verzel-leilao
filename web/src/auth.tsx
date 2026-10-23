import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Me } from './api'

type AuthState = {
  me: Me | null
  loading: boolean
  setMe: (me: Me | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    setMe(null)
  }

  return <AuthContext.Provider value={{ me, loading, setMe, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
