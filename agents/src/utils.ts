/**
 * Validates that a SQL query is safe to execute (SELECT/WITH only, single statement).
 */
export function isSafeQuery(sql: string): boolean {
  const trimmed = sql.trim();
  const normalized = trimmed.toUpperCase();

  // Only allow SELECT or WITH queries
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
    return false;
  }

  // Reject WITH + DML (INSERT/UPDATE/DELETE) — CTEs can wrap mutating statements
  if (normalized.startsWith("WITH")) {
    const hasDml = /\b(INSERT|UPDATE|DELETE)\b/.test(normalized);
    if (hasDml) {
      return false;
    }
  }

  // Reject multi-statement queries (semicolon not at the end)
  const semicolonIdx = trimmed.indexOf(";");
  if (semicolonIdx !== -1 && semicolonIdx !== trimmed.length - 1) {
    return false;
  }

  return true;
}
