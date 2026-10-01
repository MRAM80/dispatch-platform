export type Role = 'owner' | 'manager' | 'admin' | 'dispatcher' | 'driver'

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
}

type Permissions = {
  canDelete: boolean
  canManageUsers: boolean
  canViewReports: boolean
  canDispatch: boolean
  canViewDashboard: boolean
  canManageDrivers: boolean
  /** Turn whole parts of the product on and off — changes the app for everyone. */
  canConfigureSystem: boolean
}

export const ROLE_PERMISSIONS: Record<Role, Permissions> = {
  owner:      { canDelete: true,  canManageUsers: true,  canViewReports: true,  canDispatch: true,  canViewDashboard: true,  canManageDrivers: true,  canConfigureSystem: true  },
  manager:    { canDelete: true,  canManageUsers: false, canViewReports: true,  canDispatch: true,  canViewDashboard: true,  canManageDrivers: true,  canConfigureSystem: true  },
  admin:      { canDelete: false, canManageUsers: false, canViewReports: true,  canDispatch: false, canViewDashboard: true,  canManageDrivers: false, canConfigureSystem: false },
  dispatcher: { canDelete: false, canManageUsers: false, canViewReports: false, canDispatch: true,  canViewDashboard: false, canManageDrivers: false, canConfigureSystem: false },
  driver:     { canDelete: false, canManageUsers: false, canViewReports: false, canDispatch: false, canViewDashboard: false, canManageDrivers: false, canConfigureSystem: false },
}

export function can(role: Role | null, permission: keyof Permissions): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role][permission] ?? false
}
