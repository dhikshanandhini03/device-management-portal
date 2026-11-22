from enum import StrEnum


class RoleName(StrEnum):
    ADMIN = "ADMIN"
    SUPPORT_ENGINEER = "SUPPORT_ENGINEER"
    READ_ONLY = "READ_ONLY"


class Permission(StrEnum):
    DASHBOARD_VIEW = "dashboard:view"
    DEVICES_VIEW = "devices:view"
    DEVICES_MANAGE = "devices:manage"
    COMMANDS_VIEW = "commands:view"
    COMMANDS_EXECUTE = "commands:execute"
    COMMANDS_FACTORY_RESET = "commands:factory_reset"
    FIRMWARE_VIEW = "firmware:view"
    FIRMWARE_MANAGE = "firmware:manage"
    APPLICATIONS_VIEW = "applications:view"
    MONITORING_VIEW = "monitoring:view"
    ALERTS_VIEW = "alerts:view"
    ALERTS_MANAGE = "alerts:manage"
    ANALYTICS_VIEW = "analytics:view"
    USERS_MANAGE = "users:manage"
    AUDIT_VIEW = "audit:view"
    SETTINGS_MANAGE = "settings:manage"


_READ = {
    Permission.DASHBOARD_VIEW,
    Permission.DEVICES_VIEW,
    Permission.COMMANDS_VIEW,
    Permission.FIRMWARE_VIEW,
    Permission.APPLICATIONS_VIEW,
    Permission.MONITORING_VIEW,
    Permission.ALERTS_VIEW,
    Permission.ANALYTICS_VIEW,
}

ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    RoleName.ADMIN: set(Permission),
    RoleName.SUPPORT_ENGINEER: _READ | {Permission.COMMANDS_EXECUTE, Permission.ALERTS_MANAGE},
    RoleName.READ_ONLY: set(_READ),
}


def has_permission(role: str, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
