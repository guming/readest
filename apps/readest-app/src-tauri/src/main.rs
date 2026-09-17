// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(desktop)]
    if readestlib::is_agent_cli_invocation() {
        readestlib::run_agent_cli();
        return;
    }
    readestlib::run();
}
