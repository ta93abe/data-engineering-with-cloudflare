// ============================================
// Types — flattened row types for Parquet
// ============================================

export interface DailySleepRow {
  day: string;
  score: number | null;
  deep_sleep: number | null;
  efficiency: number | null;
  latency: number | null;
  rem_sleep: number | null;
  restfulness: number | null;
  timing: number | null;
  total_sleep: number | null;
  timestamp: string;
  synced_at: string;
}

export interface DailyActivityRow {
  day: string;
  score: number | null;
  active_calories: number | null;
  total_calories: number | null;
  steps: number | null;
  equivalent_walking_distance: number | null;
  high_activity_time: number | null;
  medium_activity_time: number | null;
  low_activity_time: number | null;
  sedentary_time: number | null;
  resting_time: number | null;
  met_average: number | null;
  meet_daily_targets: number | null;
  move_every_hour: number | null;
  recovery_time: number | null;
  stay_active: number | null;
  training_frequency: number | null;
  training_volume: number | null;
  timestamp: string;
  synced_at: string;
}

export interface DailyReadinessRow {
  day: string;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
  timestamp: string;
  synced_at: string;
}

export interface HeartRateRow {
  bpm: number;
  source: string;
  timestamp: string;
  day: string;
  synced_at: string;
}

// --- GitHub ---

export interface GitHubUserRow {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  synced_at: string;
}

export interface GitHubRepoRow {
  id: number;
  owner_id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  is_private: number;
  default_branch: string;
  synced_at: string;
}

export interface GitHubCommitRow {
  sha: string;
  repo_id: number;
  repo_full_name: string;
  message: string | null;
  author_name: string | null;
  author_email: string | null;
  author_date: string;
  day: string;
  synced_at: string;
}

// --- Linear ---

export interface LinearIssueRow {
  id: string;
  identifier: string;
  title: string;
  description_length: number;
  priority: number | null;
  estimate: number | null;
  state_name: string | null;
  state_type: string | null;
  label_names: string;
  project_name: string | null;
  cycle_number: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  due_date: string | null;
  synced_at: string;
}

export interface LinearProjectRow {
  id: string;
  name: string;
  state: string | null;
  progress: number | null;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  synced_at: string;
}

export interface LinearLabelRow {
  id: string;
  name: string;
  color: string | null;
  synced_at: string;
}

// --- Withings ---

export interface WithingsMeasureRow {
  grpid: number;
  date: string;
  timestamp: number;
  weight: number | null;
  fat_ratio: number | null;
  fat_mass: number | null;
  fat_free_mass: number | null;
  muscle_mass: number | null;
  bone_mass: number | null;
  hydration: number | null;
  heart_pulse: number | null;
  synced_at: string;
}

export interface WithingsSleepRow {
  date: string;
  startdate: number;
  enddate: number;
  total_sleep_duration: number | null;
  deep_sleep_duration: number | null;
  light_sleep_duration: number | null;
  rem_sleep_duration: number | null;
  wakeup_duration: number | null;
  sleep_score: number | null;
  sleep_efficiency: number | null;
  sleep_latency: number | null;
  hr_average: number | null;
  hr_min: number | null;
  hr_max: number | null;
  rr_average: number | null;
  rr_min: number | null;
  rr_max: number | null;
  snoring: number | null;
  snoring_episode_count: number | null;
  synced_at: string;
}

export interface WithingsActivityRow {
  date: string;
  steps: number | null;
  distance: number | null;
  elevation: number | null;
  soft: number | null;
  moderate: number | null;
  intense: number | null;
  active: number | null;
  calories: number | null;
  total_calories: number | null;
  hr_average: number | null;
  hr_min: number | null;
  hr_max: number | null;
  synced_at: string;
}

// ============================================
// Service Binding encoder — calls Rust Worker
// ============================================

async function encodeViaServiceBinding(
  encoder: Fetcher,
  schema: string,
  rows: Record<string, unknown>[]
): Promise<Uint8Array> {
  const res = await encoder.fetch("https://parquet-encoder/encode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema, rows }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`parquet-encoder error (${res.status}): ${text}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ============================================
// Oura encoders
// ============================================

export async function encodeDailySleep(
  encoder: Fetcher,
  rows: DailySleepRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "oura_daily_sleep", rows);
}

export async function encodeDailyActivity(
  encoder: Fetcher,
  rows: DailyActivityRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "oura_daily_activity", rows);
}

export async function encodeDailyReadiness(
  encoder: Fetcher,
  rows: DailyReadinessRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "oura_daily_readiness", rows);
}

export async function encodeHeartRate(encoder: Fetcher, rows: HeartRateRow[]): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "oura_heart_rate", rows);
}

// ============================================
// GitHub encoders
// ============================================

export async function encodeGitHubUser(
  encoder: Fetcher,
  rows: GitHubUserRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "github_user", rows);
}

export async function encodeGitHubRepo(
  encoder: Fetcher,
  rows: GitHubRepoRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "github_repo", rows);
}

export async function encodeGitHubCommit(
  encoder: Fetcher,
  rows: GitHubCommitRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "github_commit", rows);
}

// ============================================
// Linear encoders
// ============================================

export async function encodeLinearIssue(
  encoder: Fetcher,
  rows: LinearIssueRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "linear_issue", rows);
}

export async function encodeLinearProject(
  encoder: Fetcher,
  rows: LinearProjectRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "linear_project", rows);
}

export async function encodeLinearLabel(
  encoder: Fetcher,
  rows: LinearLabelRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "linear_label", rows);
}

// ============================================
// Withings encoders
// ============================================

export async function encodeWithingsMeasure(
  encoder: Fetcher,
  rows: WithingsMeasureRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "withings_measure", rows);
}

export async function encodeWithingsSleep(
  encoder: Fetcher,
  rows: WithingsSleepRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "withings_sleep", rows);
}

export async function encodeWithingsActivity(
  encoder: Fetcher,
  rows: WithingsActivityRow[]
): Promise<Uint8Array> {
  return encodeViaServiceBinding(encoder, "withings_activity", rows);
}
