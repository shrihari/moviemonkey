//! Movie Monkey's engine. Independent of Tauri so it can be tested (and one day
//! reused by a sync server for a mobile companion).

pub mod db;
pub mod images;
pub mod library;
pub mod matcher;
pub mod models;
pub mod parse;
pub mod providers;
pub mod share;
pub mod tmdb;
