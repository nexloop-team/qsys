// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--watchdog") {
        quesys_pc_lib::watchdog::run();
        return;
    }
    quesys_pc_lib::run();
}
