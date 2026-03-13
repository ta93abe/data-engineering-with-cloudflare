use arrow::array::{ArrayRef, Float64Array, Int64Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use worker::*;

/// Request body: JSON array of rows + schema name
#[derive(Deserialize)]
struct EncodeRequest {
    schema: String,
    rows: Vec<serde_json::Map<String, Value>>,
}

/// Convert JSON rows to Parquet bytes using the schema definition.
fn encode_to_parquet(schema_name: &str, rows: &[serde_json::Map<String, Value>]) -> Result<Vec<u8>> {
    let schema_def = get_schema(schema_name)
        .ok_or_else(|| Error::RustError(format!("Unknown schema: {schema_name}")))?;

    let arrow_schema = Arc::new(Schema::new(
        schema_def
            .iter()
            .map(|(name, dt)| Field::new(*name, dt.clone(), true))
            .collect::<Vec<_>>(),
    ));

    // Build columnar arrays from row-oriented JSON
    let arrays: Vec<ArrayRef> = schema_def
        .iter()
        .map(|(name, dt)| build_array(name, dt, rows))
        .collect();

    let batch = RecordBatch::try_new(arrow_schema.clone(), arrays)
        .map_err(|e| Error::RustError(format!("RecordBatch error: {e}")))?;

    let mut buf = Vec::new();
    let mut writer = ArrowWriter::try_new(&mut buf, arrow_schema, None)
        .map_err(|e| Error::RustError(format!("ArrowWriter error: {e}")))?;
    writer
        .write(&batch)
        .map_err(|e| Error::RustError(format!("Write error: {e}")))?;
    writer
        .close()
        .map_err(|e| Error::RustError(format!("Close error: {e}")))?;

    Ok(buf)
}

/// Build an Arrow array from JSON values for a given column.
fn build_array(name: &str, dt: &DataType, rows: &[serde_json::Map<String, Value>]) -> ArrayRef {
    match dt {
        DataType::Utf8 => {
            let values: Vec<Option<String>> = rows
                .iter()
                .map(|row| match row.get(name) {
                    Some(Value::String(s)) => Some(s.clone()),
                    Some(Value::Null) | None => None,
                    Some(v) => Some(v.to_string()),
                })
                .collect();
            Arc::new(StringArray::from(values))
        }
        DataType::Int64 => {
            let values: Vec<Option<i64>> = rows
                .iter()
                .map(|row| match row.get(name) {
                    Some(Value::Number(n)) => n.as_i64(),
                    _ => None,
                })
                .collect();
            Arc::new(Int64Array::from(values))
        }
        DataType::Float64 => {
            let values: Vec<Option<f64>> = rows
                .iter()
                .map(|row| match row.get(name) {
                    Some(Value::Number(n)) => n.as_f64(),
                    _ => None,
                })
                .collect();
            Arc::new(Float64Array::from(values))
        }
        _ => {
            // Fallback: treat as string
            let values: Vec<Option<String>> = rows
                .iter()
                .map(|row| row.get(name).and_then(|v| {
                    if v.is_null() { None } else { Some(v.to_string()) }
                }))
                .collect();
            Arc::new(StringArray::from(values))
        }
    }
}

/// Schema definitions for each table.
/// Returns Vec of (column_name, arrow_data_type).
fn get_schema(name: &str) -> Option<Vec<(&'static str, DataType)>> {
    Some(match name {
        // --- Oura ---
        "oura_daily_sleep" => vec![
            ("day", DataType::Utf8), ("score", DataType::Int64),
            ("deep_sleep", DataType::Int64), ("efficiency", DataType::Int64),
            ("latency", DataType::Int64), ("rem_sleep", DataType::Int64),
            ("restfulness", DataType::Int64), ("timing", DataType::Int64),
            ("total_sleep", DataType::Int64), ("timestamp", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        "oura_daily_activity" => vec![
            ("day", DataType::Utf8), ("score", DataType::Int64),
            ("active_calories", DataType::Int64), ("total_calories", DataType::Int64),
            ("steps", DataType::Int64), ("equivalent_walking_distance", DataType::Int64),
            ("high_activity_time", DataType::Int64), ("medium_activity_time", DataType::Int64),
            ("low_activity_time", DataType::Int64), ("sedentary_time", DataType::Int64),
            ("resting_time", DataType::Int64), ("met_average", DataType::Float64),
            ("meet_daily_targets", DataType::Int64), ("move_every_hour", DataType::Int64),
            ("recovery_time", DataType::Int64), ("stay_active", DataType::Int64),
            ("training_frequency", DataType::Int64), ("training_volume", DataType::Int64),
            ("timestamp", DataType::Utf8), ("synced_at", DataType::Utf8),
        ],
        "oura_daily_readiness" => vec![
            ("day", DataType::Utf8), ("score", DataType::Int64),
            ("temperature_deviation", DataType::Float64),
            ("temperature_trend_deviation", DataType::Float64),
            ("activity_balance", DataType::Int64), ("body_temperature", DataType::Int64),
            ("hrv_balance", DataType::Int64), ("previous_day_activity", DataType::Int64),
            ("previous_night", DataType::Int64), ("recovery_index", DataType::Int64),
            ("resting_heart_rate", DataType::Int64), ("sleep_balance", DataType::Int64),
            ("timestamp", DataType::Utf8), ("synced_at", DataType::Utf8),
        ],
        "oura_heart_rate" => vec![
            ("bpm", DataType::Int64), ("source", DataType::Utf8),
            ("timestamp", DataType::Utf8), ("day", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        // --- GitHub ---
        "github_user" => vec![
            ("id", DataType::Int64), ("login", DataType::Utf8),
            ("name", DataType::Utf8), ("avatar_url", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        "github_repo" => vec![
            ("id", DataType::Int64), ("owner_id", DataType::Int64),
            ("name", DataType::Utf8), ("full_name", DataType::Utf8),
            ("description", DataType::Utf8), ("language", DataType::Utf8),
            ("stars", DataType::Int64), ("forks", DataType::Int64),
            ("is_private", DataType::Int64), ("default_branch", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        "github_commit" => vec![
            ("sha", DataType::Utf8), ("repo_id", DataType::Int64),
            ("repo_full_name", DataType::Utf8), ("message", DataType::Utf8),
            ("author_name", DataType::Utf8), ("author_email", DataType::Utf8),
            ("author_date", DataType::Utf8), ("day", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        // --- Linear ---
        "linear_issue" => vec![
            ("id", DataType::Utf8), ("identifier", DataType::Utf8),
            ("title", DataType::Utf8), ("description_length", DataType::Int64),
            ("priority", DataType::Int64), ("estimate", DataType::Int64),
            ("state_name", DataType::Utf8), ("state_type", DataType::Utf8),
            ("label_names", DataType::Utf8), ("project_name", DataType::Utf8),
            ("cycle_number", DataType::Int64), ("assignee_name", DataType::Utf8),
            ("created_at", DataType::Utf8), ("updated_at", DataType::Utf8),
            ("started_at", DataType::Utf8), ("completed_at", DataType::Utf8),
            ("canceled_at", DataType::Utf8), ("due_date", DataType::Utf8),
            ("synced_at", DataType::Utf8),
        ],
        "linear_project" => vec![
            ("id", DataType::Utf8), ("name", DataType::Utf8),
            ("state", DataType::Utf8), ("progress", DataType::Float64),
            ("start_date", DataType::Utf8), ("target_date", DataType::Utf8),
            ("created_at", DataType::Utf8), ("updated_at", DataType::Utf8),
            ("completed_at", DataType::Utf8), ("synced_at", DataType::Utf8),
        ],
        "linear_label" => vec![
            ("id", DataType::Utf8), ("name", DataType::Utf8),
            ("color", DataType::Utf8), ("synced_at", DataType::Utf8),
        ],
        // --- Withings ---
        "withings_measure" => vec![
            ("grpid", DataType::Int64), ("date", DataType::Utf8),
            ("timestamp", DataType::Int64), ("weight", DataType::Float64),
            ("fat_ratio", DataType::Float64), ("fat_mass", DataType::Float64),
            ("fat_free_mass", DataType::Float64), ("muscle_mass", DataType::Float64),
            ("bone_mass", DataType::Float64), ("hydration", DataType::Float64),
            ("heart_pulse", DataType::Float64), ("synced_at", DataType::Utf8),
        ],
        "withings_sleep" => vec![
            ("date", DataType::Utf8), ("startdate", DataType::Int64),
            ("enddate", DataType::Int64),
            ("total_sleep_duration", DataType::Int64),
            ("deep_sleep_duration", DataType::Int64),
            ("light_sleep_duration", DataType::Int64),
            ("rem_sleep_duration", DataType::Int64),
            ("wakeup_duration", DataType::Int64),
            ("sleep_score", DataType::Int64), ("sleep_efficiency", DataType::Int64),
            ("sleep_latency", DataType::Int64),
            ("hr_average", DataType::Int64), ("hr_min", DataType::Int64),
            ("hr_max", DataType::Int64), ("rr_average", DataType::Int64),
            ("rr_min", DataType::Int64), ("rr_max", DataType::Int64),
            ("snoring", DataType::Int64), ("snoring_episode_count", DataType::Int64),
            ("synced_at", DataType::Utf8),
        ],
        "withings_activity" => vec![
            ("date", DataType::Utf8), ("steps", DataType::Int64),
            ("distance", DataType::Float64), ("elevation", DataType::Float64),
            ("soft", DataType::Int64), ("moderate", DataType::Int64),
            ("intense", DataType::Int64), ("active", DataType::Int64),
            ("calories", DataType::Float64), ("total_calories", DataType::Float64),
            ("hr_average", DataType::Int64), ("hr_min", DataType::Int64),
            ("hr_max", DataType::Int64), ("synced_at", DataType::Utf8),
        ],
        _ => return None,
    })
}

#[event(fetch)]
async fn main(mut req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();

    let path = req.path();

    if req.method() == Method::Post && path == "/encode" {
        let body: EncodeRequest = req.json().await?;

        if body.rows.is_empty() {
            return Response::from_bytes(vec![]);
        }

        let parquet_bytes = encode_to_parquet(&body.schema, &body.rows)?;

        let headers = Headers::new();
        headers.set("Content-Type", "application/octet-stream")?;
        Ok(Response::from_bytes(parquet_bytes)?.with_headers(headers))
    } else if req.method() == Method::Get && path == "/health" {
        Response::ok("parquet-encoder ok")
    } else if req.method() == Method::Get && path == "/schemas" {
        let schemas = vec![
            "oura_daily_sleep", "oura_daily_activity", "oura_daily_readiness", "oura_heart_rate",
            "github_user", "github_repo", "github_commit",
            "linear_issue", "linear_project", "linear_label",
            "withings_measure", "withings_sleep", "withings_activity",
        ];
        Response::from_json(&schemas)
    } else {
        Response::error("Not Found", 404)
    }
}
