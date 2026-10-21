import { LayoutDashboard, Users, BookOpen, Banknote, Layers, CircleDollarSign, Settings, Receipt } from 'lucide-react'

export const adminNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { href: '/admin/catalogo', label: 'Listas maestras', icon: BookOpen },
  { href: '/admin/planes', label: 'Planes', icon: Banknote },
  { href: '/admin/suscripciones', label: 'Suscripciones', icon: Layers },
  { href: '/admin/facturacion', label: 'Facturación', icon: Receipt },
  { href: '/admin/ipc', label: 'IPC y actualizaciones', icon: CircleDollarSign },
  { href: '/admin/configuracion', label: 'Configuración', icon: Settings },
]

// Se mantiene por compatibilidad con quien todavía importe la forma agrupada.
export const adminNavGroups = [{ label: null, links: adminNavItems }]
