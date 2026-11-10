//! Performance readings sent with each check-in, so the floor can show a PC that is overheating,
//! out of disk space or short on memory before a player complains.
//!
//! CPU, memory and disks come from Windows itself. GPU readings come from `nvidia-smi`, which comes
//! with every NVIDIA driver; on other GPUs they are simply left out.

use serde::Serialize;
use serde_json::{json, Value};
use std::process::Command;
use std::time::{Duration, Instant};
use sysinfo::{Disks, System};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const GB: f64 = 1024.0 * 1024.0 * 1024.0;
/// nvidia-smi starts a process: once a minute is plenty.
const GPU_EVERY: Duration = Duration::from_secs(60);
/// No NVIDIA GPU (or no driver tool): look again after 10 minutes.
const GPU_RETRY: Duration = Duration::from_secs(600);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Gpu {
    pub name: String,
    /// Busy, in %.
    pub util: f64,
    /// °C
    pub temp: f64,
    pub vram_used_gb: f64,
    pub vram_total_gb: f64,
}

pub struct Monitor {
    sys: System,
    disks: Disks,
    gpu: Option<Gpu>,
    gpu_next: Instant,
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Monitor {
    pub fn new() -> Monitor {
        let mut sys = System::new();
        // CPU use is measured between two refreshes; this is the first.
        sys.refresh_cpu_usage();
        Monitor { sys, disks: Disks::new_with_refreshed_list(), gpu: None, gpu_next: Instant::now() }
    }

    /// One set of readings. Call every check-in (about every 15 s).
    pub fn sample(&mut self) -> Value {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.disks.refresh_list();

        if Instant::now() >= self.gpu_next {
            self.gpu = read_gpu();
            self.gpu_next = Instant::now() + if self.gpu.is_some() { GPU_EVERY } else { GPU_RETRY };
        }

        let system_disk = self
            .disks
            .iter()
            .filter(|d| !d.is_removable())
            .find(|d| {
                let m = d.mount_point().to_string_lossy().to_ascii_uppercase();
                m == "C:\\" || m == "/"
            })
            .or_else(|| self.disks.iter().filter(|d| !d.is_removable()).max_by_key(|d| d.total_space()));

        json!({
            "cpu": round1(self.sys.global_cpu_usage() as f64),
            "ram_used_gb": round1(self.sys.used_memory() as f64 / GB),
            "ram_total_gb": round1(self.sys.total_memory() as f64 / GB),
            "disk_free_gb": system_disk.map(|d| round1(d.available_space() as f64 / GB)),
            "disk_total_gb": system_disk.map(|d| round1(d.total_space() as f64 / GB)),
            "uptime_h": round1(System::uptime() as f64 / 3600.0),
            "gpu": self.gpu,
            "usb": self.removable_drives(),
        })
    }

    /// Removable drives plugged in now, e.g. ["E:\\"].
    pub fn removable_drives(&self) -> Vec<String> {
        removable(&self.disks)
    }
}

/// Removable drives in a disk list (refresh it first).
pub fn removable(disks: &Disks) -> Vec<String> {
    let mut v: Vec<String> = disks
        .iter()
        .filter(|d| d.is_removable())
        .map(|d| d.mount_point().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v.dedup();
    v
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn read_gpu() -> Option<Gpu> {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_nvidia_smi(&String::from_utf8_lossy(&out.stdout))
}

/// First GPU from `nvidia-smi --format=csv,noheader,nounits`, e.g.
/// "NVIDIA GeForce RTX 3060, 35, 61, 2048, 12288" (memory in MiB).
pub fn parse_nvidia_smi(text: &str) -> Option<Gpu> {
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.len() < 5 {
        return None;
    }
    let num = |s: &str| s.parse::<f64>().ok();
    Some(Gpu {
        name: parts[0].chars().take(60).collect(),
        util: num(parts[1])?,
        temp: num(parts[2])?,
        vram_used_gb: round1(num(parts[3])? / 1024.0),
        vram_total_gb: round1(num(parts[4])? / 1024.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nvidia_smi() {
        let g = parse_nvidia_smi("NVIDIA GeForce RTX 3060, 35, 61, 2048, 12288\n").unwrap();
        assert_eq!(g.name, "NVIDIA GeForce RTX 3060");
        assert_eq!((g.util, g.temp), (35.0, 61.0));
        assert_eq!((g.vram_used_gb, g.vram_total_gb), (2.0, 12.0));
        assert!(parse_nvidia_smi("").is_none());
        assert!(parse_nvidia_smi("[N/A], [N/A]").is_none());
        assert!(parse_nvidia_smi("GPU, [N/A], 40, 1, 2").is_none());
    }

    #[test]
    fn sample_has_the_basics() {
        let mut m = Monitor::new();
        let v = m.sample();
        assert!(v["cpu"].is_number());
        assert!(v["ram_total_gb"].as_f64().unwrap() > 0.0);
        assert!(v["usb"].is_array());
    }
}
