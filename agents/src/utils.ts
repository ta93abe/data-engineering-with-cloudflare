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

  // Reject multi-statement queries (semicolon not at the end)
  const semicolonIdx = trimmed.indexOf(";");
  if (semicolonIdx !== -1 && semicolonIdx !== trimmed.length - 1) {
    return false;
  }

  return true;
}
