use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaSessionSummary {
    pub session_id: String,
    pub app_name: String,
    pub browser_type: Option<String>,
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaUpdatePayload {
    pub session_id: String,
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub position: f64,
    pub duration: f64,
    pub album_art: Option<String>,
    pub is_shuffle: Option<bool>,
    pub source_app: String,
    pub is_browser: bool,
    pub is_spotify: bool,
    pub active_sessions: Vec<MediaSessionSummary>,
}
