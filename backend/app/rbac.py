"""Role Based Access Control — the SRS §5.3 permission matrix as data.

Roles: SA System Administrator, SS Security Supervisor, GO Gate Operator,
RM Registry Manager, AU Auditor, RV Report Viewer. One role per user
(§5.4 rule 1). Deny by default (§5.4, FR-SEC-06): a permission exists for
a role only if it is listed here. The matrix is enforced on the server for
every request; hiding controls in the UI is never the protection.
"""

ROLES = {
    "SA": "System Administrator",
    "SS": "Security Supervisor",
    "GO": "Gate Operator",
    "RM": "Registry Manager",
    "AU": "Auditor",
    "RV": "Report Viewer",
}

# permission code -> roles that hold it (SRS §5.3)
PERMISSIONS = {
    "dashboard.view":       {"SA", "SS", "GO", "RM", "AU", "RV"},
    "live.view":            {"SA", "SS", "GO"},
    "event.read":           {"SA", "SS", "GO", "RM", "AU", "RV"},
    "event.image":          {"SA", "SS", "GO", "AU"},
    "purpose.edit":         {"SS", "GO"},
    "review.resolve":       {"SS", "GO"},
    "plate.correct":        {"SS", "GO"},
    "event.discard":        {"SS", "GO"},
    "event.create_manual":  {"SS", "GO"},
    "registry.read":        {"SA", "SS", "GO", "RM", "AU"},
    "registry.write":       {"SA", "RM"},
    "registry.import":      {"SA", "RM"},
    "registry.status":      {"SA", "SS", "RM"},
    "report.generate":      {"SA", "SS", "AU", "RV"},
    "report.export":        {"SA", "SS", "AU", "RV"},
    "alert.acknowledge":    {"SA", "SS", "GO"},
    "camera.manage":        {"SA"},
    "user.manage":          {"SA"},
    "config.manage":        {"SA"},
    "legal.hold":           {"SA", "SS"},
    "audit.view":           {"SA", "AU"},
    "audit.export":         {"AU"},
    "audit.verify":         {"SA", "AU"},
    "privacy.manage":       {"SA", "RM"},
    "session.close_manual": {"SS"},
    "password.own":         {"SA", "SS", "GO", "RM", "AU", "RV"},
}

# Roles that must use MFA (FR-SEC-02)
MFA_REQUIRED_ROLES = {"SA", "SS"}


def has_permission(role: str, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, set())


def permissions_for(role: str):
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)
