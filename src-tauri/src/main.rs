// Windows'ta uygulama penceresinin arkasinda konsol acilmasini engeller.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    baski_maliyet_lib::run()
}
