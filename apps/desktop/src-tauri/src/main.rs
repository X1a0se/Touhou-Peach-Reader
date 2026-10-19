// Windows 下发布版不弹控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    touhou_peach_reader_lib::run();
}
